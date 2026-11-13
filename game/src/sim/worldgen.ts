// Builds the home valley from a seed. Fixed landmarks are placed by hand; the rest is grown from noise.
import { MAP_H, MAP_W } from '../core/config';
import { clamp, fbm, mulberry32, valueNoise } from '../core/rng';
import { T, World, idx } from './world';

/** Fixed places in the valley. Other systems read these. */
export const PLACES = {
  house: { x: 38, y: 37 },
  /** Where you wake up and where hands and you go to sleep. In front of the house's east face. */
  bed: { x: 42.5, y: 39 },
  well: { x: 44, y: 35 },
  radio: { x: 36, y: 42 },
  campfire: { x: 43, y: 43 },
  field: { x0: 45, y0: 38, x1: 57, y1: 51 },
  crate: { x: 47, y: 56 },
  /** The trader parks here, nose west. */
  truckStop: { x: 48.5, y: 59.5 },
  truckEnter: { x: 95.5, y: 59.5 },
  /** Where drifters wait to be hired. */
  gate: { x: 52, y: 58 },
  ruins: { x0: 62, y0: 10, x1: 88, y1: 32 },
  /** Husks come from here at night. */
  huskSpawns: [
    { x: 92, y: 8 }, { x: 80, y: 4 }, { x: 70, y: 14 }, { x: 86, y: 26 }, { x: 93, y: 34 },
    { x: 66, y: 5 }, { x: 93, y: 46 }, { x: 60, y: 30 }
  ]
} as const;

function creekX(y: number): number {
  return 19 + 5 * Math.sin(y / 11) + 2 * Math.sin(y / 5.3 + 1.7);
}

function creekW(y: number): number {
  return 1.5 + 0.6 * Math.sin(y / 7 + 0.4);
}

function inField(x: number, y: number): boolean {
  const f = PLACES.field;
  return x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
}

/** Ground kept clear of random clutter: the yard, the field, the depot and the roads. */
function reserved(x: number, y: number): boolean {
  if (x >= 33 && x <= 60 && y >= 31 && y <= 54) return true;
  if (x >= 42 && x <= 52 && y >= 53 && y <= 62) return true;
  if (y >= 57 && y <= 62 && x >= 42) return true;
  return false;
}

export function generate(world: World, seed: number): void {
  const rng = mulberry32(seed);
  const W = MAP_W;
  const H = MAP_H;

  // ---- Terrain ----
  for (let y = 0; y < H; y++) {
    const cx = creekX(y);
    const cw = creekW(y);
    for (let x = 0; x < W; x++) {
      const k = idx(x, y);
      const n = fbm(x / 13, y / 13, seed, 4);
      const dCreek = Math.abs(x - cx);
      const wetness = clamp(1 - dCreek / 22, 0, 1) * 0.55 + fbm(x / 9, y / 9, seed + 3, 3) * 0.6;
      let t = T.Dry;
      if (wetness > 0.62) t = T.Grass;
      else if (n < 0.36) t = T.Dirt;
      if (dCreek < cw + 1.3 + valueNoise(x / 3, y / 3, seed + 5) * 0.9) t = T.Sand;
      if (dCreek < cw) t = T.Water;
      if (dCreek < cw * 0.42) t = T.Deep;
      // Pond in the south-west
      const pd = Math.hypot((x - 27) / 4.5, (y - 67) / 3.4);
      if (pd < 1.35) t = T.Sand;
      if (pd < 1) t = T.Water;
      if (pd < 0.5) t = T.Deep;
      // Ash country in the far north-east
      const ash = (x - 72) / 14 - (y - 4) / 18 + (valueNoise(x / 6, y / 6, seed + 9) - 0.5) * 0.8;
      if (ash > 0.6 && t !== T.Water && t !== T.Deep) t = T.Ash;
      world.terrain[k] = t;

      // Contamination
      let c = fbm(x / 10, y / 10, seed + 7, 3) * 0.3;
      if (t === T.Water || t === T.Deep) c += 0.65;
      else if (dCreek < cw + 4) c += 0.3 * (1 - (dCreek - cw) / 4);
      if (t === T.Ash) c += 0.55;
      const r = PLACES.ruins;
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) c += 0.25;
      const dHouse = Math.hypot(x - 42, y - 42);
      if (dHouse < 14) c *= 0.25 + (dHouse / 14) * 0.75;
      // A bad patch in the east of the field, to be cleaned with sunflowers
      const dp = Math.hypot(x - 54.5, y - 47.5);
      if (dp < 3.2) c += 0.62 * (1 - dp / 3.2) + 0.15;
      world.contam[k] = clamp(c, 0, 1);

      // Fertility
      let f = 0.3 + fbm(x / 8, y / 8, seed + 11, 3) * 0.4 + clamp(1 - dCreek / 14, 0, 1) * 0.2;
      if (t === T.Ash) f *= 0.3;
      world.fert[k] = clamp(f, 0.05, 1);
    }
  }

  // Field, yard and tracks
  const f = PLACES.field;
  for (let y = f.y0 - 1; y <= f.y1 + 1; y++)
    for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
      const k = idx(x, y);
      const edge = x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1;
      if (!edge || valueNoise(x, y, seed + 13) < 0.6) world.terrain[k] = T.Dirt;
      world.fert[k] = clamp(0.45 + fbm(x / 4, y / 4, seed + 17, 2) * 0.35, 0, 1);
    }
  const fill = (x0: number, y0: number, x1: number, y1: number, t: T) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.terrain[idx(x, y)] = t;
  };
  // Yard around the house
  for (let y = 34; y <= 46; y++)
    for (let x = 35; x <= 44; x++) if (Math.hypot(x - 40, y - 40) < 6.4 + valueNoise(x / 2, y / 2, seed) * 1.2) world.terrain[idx(x, y)] = T.Track;
  // Track from the yard to the field and down to the depot
  fill(42, 41, 44, 42, T.Track);
  fill(45, 52, 47, 55, T.Track);
  fill(44, 44, 45, 52, T.Track);
  // Depot pad
  fill(44, 55, 50, 57, T.Concrete);
  // The road east to the Hull
  fill(42, 58, MAP_W - 1, 60, T.Road);
  // The old highway through the ruins
  fill(56, 20, MAP_W - 1, 22, T.Road);
  for (let x = 40; x < 56; x++) if (valueNoise(x / 3, 1, seed) > 0.35) fill(x, 20, x, 22, T.Road);
  // Ruin floors
  const ruinsB: [number, number, number, number][] = [
    [64, 13, 70, 18], [73, 12, 80, 17], [66, 24, 72, 30], [76, 25, 84, 31], [84, 14, 88, 18]
  ];
  for (const [x0, y0, x1, y1] of ruinsB) fill(x0, y0, x1, y1, T.Concrete);

  // ---- Fixed objects ----
  world.add('farmhouse', PLACES.house.x, PLACES.house.y);
  world.add('well', PLACES.well.x, PLACES.well.y);
  world.add('radio', PLACES.radio.x, PLACES.radio.y);
  world.add('campfire', PLACES.campfire.x, PLACES.campfire.y);
  world.add('crate', PLACES.crate.x, PLACES.crate.y);

  // Ruined buildings: walls round the floors with gaps
  for (const [x0, y0, x1, y1] of ruinsB) {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        if (!edge) {
          if (rng() < 0.08) world.add('scrap_pile', x, y, Math.floor(rng() * 3));
          continue;
        }
        if (rng() < 0.28) continue;
        world.add('ruin_wall', x, y, Math.floor(rng() * 3));
      }
  }
  // Wrecks on the old highway and one by the road
  for (const [x, y] of [[61, 21], [69, 20], [83, 22], [90, 21], [70, 59]] as [number, number][]) {
    if (!world.objAt[idx(x, y)]) world.add('wreck', x, y, Math.floor(rng() * 3));
  }

  // ---- Scattered nature ----
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const k = idx(x, y);
      if (world.objAt[k] || reserved(x, y)) continue;
      const t = world.terrain[k];
      if (t === T.Water || t === T.Deep || t === T.Road || t === T.Concrete) continue;
      const r = rng();
      const pineZone = fbm(x / 12, y / 12, seed + 21, 3) + (x < 34 && y < 34 ? 0.25 : -0.1);
      if (t !== T.Ash && t !== T.Sand && pineZone > 0.68 && r < 0.22) world.add('tree_pine', x, y, Math.floor(rng() * 3));
      else if (r < 0.016) world.add('tree_dead', x, y, Math.floor(rng() * 3));
      else if (t === T.Dry && r < 0.05) world.add('saltbush', x, y, Math.floor(rng() * 3));
      else if (t === T.Grass && r < 0.035) world.add('saltbush', x, y, Math.floor(rng() * 3));
      else if (r < 0.062) world.add('rock', x, y, Math.floor(rng() * 3));
      else if (r < 0.066) world.add('boulder', x, y, Math.floor(rng() * 2));
      else if (t === T.Ash && r < 0.09) world.add('scrap_pile', x, y, Math.floor(rng() * 3));
    }
  // Weeds and a few stones in the field, to clear on the first morning
  for (let y = f.y0; y <= f.y1; y++)
    for (let x = f.x0; x <= f.x1; x++) {
      const r = rng();
      if (r < 0.09) world.add('weed', x, y, Math.floor(rng() * 3));
      else if (r < 0.105) world.add('rock', x, y, Math.floor(rng() * 3));
    }
  // A couple of dead trees in the yard for the first wood
  for (const [x, y] of [[34, 45], [47, 33], [59, 44], [58, 36]] as [number, number][]) if (!world.objAt[idx(x, y)]) world.add('tree_dead', x, y, Math.floor(rng() * 3));
  for (const [x, y] of [[60, 52], [33, 39]] as [number, number][]) if (!world.objAt[idx(x, y)]) world.add('scrap_pile', x, y, 1);

  world.terrainVersion++;
}

export { inField };
