// Paints the ground, one chunk at a time, pixel by pixel from the terrain and soil data.
// Patterns use world pixel coordinates so they run seamlessly across chunk edges.
import { CHUNK, HALF_H, HALF_W, MAP_H, MAP_W } from '../core/config';
import { hash2, valueNoise } from '../core/rng';
import { T, World, idx } from '../sim/world';
import { makeCanvas, Cv, hex, RGB } from './pixel';

type Ramp = RGB[];

const R = (...c: string[]): Ramp => c.map(hex);

const RAMPS: Record<number, Ramp> = {
  [T.Grass]: R('#3f4a26', '#4f5c2c', '#5f6d33', '#71803c', '#86924a'),
  [T.Dry]: R('#6a5a35', '#7d6c3f', '#8e7c48', '#a08e55', '#b3a165'),
  [T.Dirt]: R('#4c3a28', '#5c4630', '#6c5338', '#7c6142', '#8d714f'),
  [T.Track]: R('#5f4c36', '#6f5a40', '#7e684a', '#8c7654', '#9a8460'),
  [T.Road]: R('#2e2d2c', '#383735', '#42403d', '#4b4945', '#56534e'),
  [T.Water]: R('#1f3b40', '#264850', '#2e555c', '#386468', '#477676'),
  [T.Deep]: R('#152a31', '#19323a', '#1e3a42', '#23434a', '#2a4c52'),
  [T.Ash]: R('#4d4a46', '#5a5651', '#67635d', '#76716a', '#858078'),
  [T.Concrete]: R('#4f4c46', '#5d5a53', '#6b6760', '#79756c', '#878278'),
  [T.Sand]: R('#6f6046', '#7f6e50', '#8f7d5a', '#9f8d66', '#ae9c73')
};

/** Which terrain wins at a ragged border. Higher spreads over lower. */
const PRIORITY: Record<number, number> = {
  [T.Deep]: 0, [T.Water]: 1, [T.Sand]: 2, [T.Road]: 3, [T.Concrete]: 4, [T.Track]: 5,
  [T.Dirt]: 6, [T.Dry]: 7, [T.Grass]: 8, [T.Ash]: 9
};

const SICK: RGB = hex('#7f7d45');
const SICK_WATER: RGB = hex('#3f5a2a');

function terrainAt(world: World, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return T.Dry;
  return world.terrain[idx(x, y)];
}

/** Picks a ramp index 0..4 from a value in [0,1) with hard steps (posterised, for a pixel look). */
function step(v: number): number {
  return v < 0.2 ? 0 : v < 0.42 ? 1 : v < 0.66 ? 2 : v < 0.86 ? 3 : 4;
}

/**
 * Small hand-placed-looking marks on a grid of cells: tufts of grass, pebbles, flecks.
 * Returns 0 for none, 1 for the lit part, 2 for the shadowed part.
 */
function mark(sx: number, sy: number, seed: number, cell: number, density: number, kind: 'tuft' | 'pebble' | 'blade'): number {
  const cx = Math.floor(sx / cell);
  const cy = Math.floor(sy / cell);
  if (hash2(cx, cy, seed) > density) return 0;
  const ox = Math.floor(hash2(cx, cy, seed + 1) * (cell - 2));
  const oy = Math.floor(hash2(cx, cy, seed + 2) * (cell - 3));
  const lx = sx - cx * cell - ox;
  const ly = sy - cy * cell - oy;
  if (kind === 'tuft') {
    // A small V of blades: lit tips, dark base
    if ((lx === 0 && ly === 0) || (lx === 2 && ly === 0)) return 1;
    if ((lx === 0 || lx === 2) && ly === 1) return 1;
    if (lx === 1 && (ly === 1 || ly === 2)) return 2;
    return 0;
  }
  if (kind === 'blade') {
    if (lx === 0 && ly === 0) return 1;
    if (lx === 0 && ly === 1) return 2;
    return 0;
  }
  // Pebble: lit top-left pixel, shadow beneath
  if (lx >= 0 && lx <= 1 && ly === 0) return 1;
  if (lx >= 0 && lx <= 1 && ly === 1) return 2;
  return 0;
}

function pixelColour(t: number, sx: number, sy: number, tx: number, ty: number, seed: number): RGB {
  const ramp = RAMPS[t];
  // Large mottling in tile space, softer mid-scale clumps in pixel space, very little grain
  const big = valueNoise(tx * 0.42, ty * 0.42, seed + 31);
  const mid = valueNoise(sx / 9, sy / 5.5, seed + 37);
  const grain = hash2(sx >> 1, sy, seed + 41);
  let v = big * 0.5 + mid * 0.42 + grain * 0.08;
  switch (t) {
    case T.Grass: {
      const m = mark(sx, sy, seed + 43, 5, 0.42, 'tuft');
      if (m === 1) v = Math.min(0.99, v + 0.42);
      else if (m === 2) v = Math.max(0, v - 0.3);
      break;
    }
    case T.Dry: {
      const m = mark(sx, sy, seed + 47, 4, 0.3, 'blade');
      if (m === 1) v = Math.min(0.99, v + 0.45);
      else if (m === 2) v = Math.max(0, v - 0.25);
      break;
    }
    case T.Dirt:
    case T.Track: {
      const m = mark(sx, sy, seed + 53, 7, 0.22, 'pebble');
      if (m === 1) v = Math.min(0.99, v + 0.4);
      else if (m === 2) v = Math.max(0, v - 0.35);
      if (t === T.Track) {
        // Wheel ruts
        const rut = Math.abs(((tx + ty) * 2.0) % 1 - 0.5);
        if (rut < 0.06) v *= 0.6;
      }
      break;
    }
    case T.Road: {
      const crack = Math.abs(valueNoise(sx / 9, sy / 5, seed + 59) - 0.5);
      if (crack < 0.018) v = 0.0;
      // Faded centre line along the road's length (x axis)
      const fy = ty - Math.floor(ty);
      if (Math.abs(fy - 0.0) < 0.04 && Math.floor(tx * 1.5) % 2 === 0 && big > 0.3) return hex('#8a826a');
      break;
    }
    case T.Concrete: {
      const fx = tx - Math.floor(tx);
      const fy = ty - Math.floor(ty);
      if (fx < 0.035 || fy < 0.035) v = 0.05; // slab joints
      const crack = Math.abs(valueNoise(sx / 7, sy / 4, seed + 61) - 0.5);
      if (crack < 0.015) v = 0.0;
      break;
    }
    case T.Water:
    case T.Deep: {
      const ripple = Math.sin(sx * 0.35 + valueNoise(sx / 12, sy / 6, seed + 67) * 6) * Math.sin(sy * 0.9);
      v = big * 0.5 + (ripple > 0.82 ? 0.45 : ripple * 0.12 + 0.2);
      break;
    }
    case T.Ash: {
      const m = mark(sx, sy, seed + 71, 6, 0.25, 'pebble');
      if (m === 1) v = Math.min(0.99, v + 0.45);
      else if (m === 2) v = Math.max(0, v - 0.3);
      break;
    }
    case T.Sand: {
      const m = mark(sx, sy, seed + 73, 6, 0.18, 'pebble');
      if (m === 1) v = Math.min(0.99, v + 0.3);
      else if (m === 2) v = Math.max(0, v - 0.25);
      break;
    }
  }
  return ramp[step(Math.min(0.999, Math.max(0, v)))];
}

/** The chunk's top-left in world screen pixels, and its size. */
export function chunkOrigin(cx: number, cy: number): { ox: number; oy: number; w: number; h: number } {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  return { ox: (x0 - y0 - CHUNK) * HALF_W, oy: (x0 + y0) * HALF_H, w: CHUNK * 2 * HALF_W, h: CHUNK * 2 * HALF_H };
}

export function paintChunk(world: World, cx: number, cy: number, seed: number): Cv {
  const { ox, oy, w, h } = chunkOrigin(cx, cy);
  const cv = makeCanvas(w, h);
  const img = cv.ctx.createImageData(w, h);
  const d = img.data;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  for (let py = 0; py < h; py++) {
    const sy = oy + py + 0.5;
    for (let ppx = 0; ppx < w; ppx++) {
      const sx = ox + ppx + 0.5;
      const a = sx / HALF_W;
      const b = sy / HALF_H;
      const tx = (a + b) / 2;
      const ty = (b - a) / 2;
      const i = Math.floor(tx);
      const j = Math.floor(ty);
      if (i < x0 || j < y0 || i >= x0 + CHUNK || j >= y0 + CHUNK) continue;
      if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_H) continue;
      let t = world.terrain[idx(i, j)];
      // Ragged borders: near an edge, a higher-priority neighbour can bleed over
      const fx = tx - i;
      const fy = ty - j;
      const edge = 0.42;
      const jitter = valueNoise(sx / 3.2, sy / 2.2, seed + 3) * 0.55 + hash2(Math.floor(sx), Math.floor(sy), seed + 5) * 0.12;
      let best = t;
      let bestP = PRIORITY[t];
      const tryN = (nx: number, ny: number, dist: number) => {
        if (dist > edge) return;
        const tn = terrainAt(world, nx, ny);
        if (tn === t) return;
        const pn = PRIORITY[tn];
        if (pn <= bestP) return;
        if ((edge - dist) / edge * 0.75 > jitter) {
          best = tn;
          bestP = pn;
        }
      };
      tryN(i - 1, j, fx);
      tryN(i + 1, j, 1 - fx);
      tryN(i, j - 1, fy);
      tryN(i, j + 1, 1 - fy);
      t = best;
      let c = pixelColour(t, Math.floor(sx), Math.floor(sy), tx, ty, seed);
      // Wet sand next to water
      if (t === T.Sand) {
        const nearWater = world.isWater(i - 1, j) || world.isWater(i + 1, j) || world.isWater(i, j - 1) || world.isWater(i, j + 1);
        if (nearWater) c = [c[0] * 0.82, c[1] * 0.82, c[2] * 0.86];
      }
      // Contamination shows as a sickly cast, in two hard steps
      const k = idx(i, j);
      const cn = world.contam[k];
      if (cn > 0.38) {
        const water = t === T.Water || t === T.Deep;
        const amt = cn > 0.62 ? 0.42 : 0.24;
        const S = water ? SICK_WATER : SICK;
        c = [c[0] + (S[0] - c[0]) * amt, c[1] + (S[1] - c[1]) * amt, c[2] + (S[2] - c[2]) * amt];
      }
      const o = (py * w + ppx) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  cv.ctx.putImageData(img, 0, 0);
  return cv;
}
