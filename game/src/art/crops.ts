// Crops at each growth stage, the tilled soil they grow in, and ground marks.
import { mulberry32 } from '../core/rng';
import { CROPS, CropDef } from '../data';
import { Atlas } from './atlas';
import { Cv, crisp, ellipse, line, makeCanvas, mix, outline, poly, px, shade } from './pixel';

/** Growth stage 0..4 from age. 0 seed, 1 sprout, 2 young, 3 grown, 4 ripe. */
export function cropStage(def: CropDef, age: number, ripe: boolean): number {
  if (ripe) return 4;
  const t = age / def.days;
  return t < 0.12 ? 0 : t < 0.4 ? 1 : t < 0.72 ? 2 : 3;
}

function paintCrop(def: CropDef, stage: number, tainted: boolean, dead: boolean): Cv {
  const rng = mulberry32(def.id.length * 97 + stage * 13);
  const cv = makeCanvas(24, 34);
  const ctx = cv.ctx;
  const bx = 12;
  const by = 30;
  let leaf = def.leaf;
  let fruit = def.fruit;
  if (tainted) {
    leaf = mix(leaf, '#8a8a3a', 0.45);
    fruit = mix(fruit, '#7a6a8a', 0.4);
  }
  if (dead) {
    leaf = '#6a5a3a';
    fruit = '#5a4a32';
  }
  const leafHi = shade(leaf, 0.22);
  const leafLo = shade(leaf, -0.25);
  const blade = (x: number, y: number, len: number, ang: number, w = 1.6, c = leaf) => {
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    line(ctx, x, y, ex, ey, w, c);
    return [ex, ey] as const;
  };
  if (stage === 0) {
    // A seeded mound
    ellipse(ctx, bx, by - 1, 3, 1.5, '#3a2a1e');
    px(ctx, bx - 1, by - 2, '#c8b080', 1, 1);
    px(ctx, bx + 1, by - 1, '#c8b080', 1, 1);
    crisp(cv);
    return cv;
  }
  if (stage === 1) {
    blade(bx, by, 4, -Math.PI / 2 - 0.5, 1.2);
    blade(bx, by, 4, -Math.PI / 2 + 0.5, 1.2, leafHi);
    crisp(cv);
    outline(cv);
    return cv;
  }
  const grown = stage >= 3;
  const ripe = stage === 4;
  switch (def.shape) {
    case 'root':
    case 'leafy':
    case 'bush': {
      const n = stage === 2 ? 5 : 8;
      const h = stage === 2 ? 6 : def.shape === 'bush' ? 10 : 9;
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.2 + (rng() - 0.5) * 0.3;
        const [ex, ey] = blade(bx, by - 1, h * (0.7 + rng() * 0.4), ang, def.shape === 'leafy' ? 2.6 : 1.8, i % 2 ? leaf : leafLo);
        if (def.shape === 'leafy' || def.shape === 'bush') ellipse(ctx, ex, ey, 2.2, 1.6, i % 3 === 0 ? leafHi : leaf);
      }
      if (ripe && def.shape === 'root') {
        ellipse(ctx, bx, by - 1, 3.2, 2.4, fruit);
        px(ctx, bx - 2, by - 2, shade(fruit, 0.3), 2, 1);
      }
      if (ripe && def.shape === 'bush') for (let i = 0; i < 3; i++) ellipse(ctx, bx - 4 + i * 4, by - 1, 1.8, 1.4, fruit);
      if (def.shape === 'leafy' && grown) for (let i = 0; i < 4; i++) px(ctx, bx - 4 + rng() * 8, by - 10 + rng() * 6, leafHi, 1, 2);
      break;
    }
    case 'vine': {
      // Staked vine
      const stake = '#7a6248';
      const top = stage === 2 ? 12 : 20;
      line(ctx, bx, by, bx, by - top - 2, 1, stake);
      for (let y = 0; y < top; y += 2.5) {
        const side = (Math.floor(y / 2.5) % 2) * 2 - 1;
        blade(bx, by - y - 1, 3.5 + rng() * 1.5, -Math.PI / 2 + side * 1.0, 2.2, y % 5 < 2.5 ? leaf : leafHi);
      }
      if (ripe)
        for (let i = 0; i < 4; i++) {
          const fx = bx + (i % 2 ? 3 : -3);
          const fy = by - 5 - i * 4;
          if (def.id === 'beans') line(ctx, fx, fy, fx, fy + 4, 1.4, fruit);
          else ellipse(ctx, fx, fy, 1.9, 1.9, fruit);
        }
      break;
    }
    case 'stalk': {
      const top = stage === 2 ? 14 : 24;
      for (const off of [-2, 2]) {
        line(ctx, bx + off, by, bx + off * 0.6, by - top, 1.8, leafLo);
        for (let y = 4; y < top; y += 4) blade(bx + off * 0.8, by - y, 5, -Math.PI / 2 + (off > 0 ? 0.9 : -0.9), 1.3, leaf);
      }
      if (ripe) {
        ellipse(ctx, bx + 3, by - top * 0.6, 1.6, 3.4, fruit);
        ellipse(ctx, bx - 3, by - top * 0.5, 1.6, 3.4, shade(fruit, -0.1));
        px(ctx, bx + 3, by - top * 0.6 - 4, '#c8a858', 1, 2);
      }
      break;
    }
    case 'flower': {
      const top = stage === 2 ? 12 : 22;
      line(ctx, bx, by, bx, by - top, 1.8, leafLo);
      for (let y = 4; y < top - 2; y += 5) {
        blade(bx, by - y, 4, -Math.PI / 2 - 1.0, 2.2, leaf);
        blade(bx, by - y - 2, 4, -Math.PI / 2 + 1.0, 2.2, leafHi);
      }
      if (grown) {
        const r = ripe ? 4.5 : 3;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          ellipse(ctx, bx + Math.cos(a) * r, by - top + Math.sin(a) * r * 0.9, 1.6, 1.6, ripe ? fruit : shade(fruit, -0.15));
        }
        ellipse(ctx, bx, by - top, r * 0.55, r * 0.5, '#4a3020');
      }
      break;
    }
    case 'gourd': {
      const n = stage === 2 ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const ang = Math.PI + (i / n) * Math.PI * 1.0 + rng() * 0.2;
        const [ex, ey] = blade(bx, by - 2, 7 + rng() * 3, ang, 1.4, leafLo);
        ellipse(ctx, ex, ey, 3, 2.2, i % 2 ? leaf : leafHi);
      }
      if (grown) {
        const r = ripe ? 5.5 : 3;
        const c = ripe ? fruit : '#7a9a3a';
        ellipse(ctx, bx + 1, by - r * 0.8, r, r * 0.8, c);
        line(ctx, bx + 1, by - r * 1.5, bx + 1, by - r * 0.2, 1, shade(c, -0.2));
        line(ctx, bx - r * 0.4, by - r * 1.3, bx - r * 0.4, by - r * 0.3, 1, shade(c, -0.2));
        px(ctx, bx - 1, by - r * 1.4, shade(c, 0.35), 2, 1);
        line(ctx, bx + 1, by - r * 1.6, bx + 2, by - r * 1.6 - 2, 1.2, '#5a4a2a');
      }
      break;
    }
  }
  crisp(cv);
  outline(cv);
  return cv;
}

function tilled(wet: boolean): Cv {
  const cv = makeCanvas(32, 17);
  const ctx = cv.ctx;
  const base = wet ? '#2f2219' : '#4a3626';
  poly(ctx, [16, 1, 30, 8, 16, 15, 2, 8], base);
  // Furrows along the tile's x axis
  const ridge = wet ? '#3d2c20' : '#5e4630';
  const groove = wet ? '#21170f' : '#382818';
  for (let k = 0; k < 4; k++) {
    const y0 = 4 + k * 2.6;
    line(ctx, 16 - 9 + k * 3.2 - 3, y0 + 1, 16 + 6 + k * 3.2 - 3, y0 + 1 + 7.5 * 0.5, 1, ridge);
    line(ctx, 16 - 9 + k * 3.2 - 3, y0 + 2, 16 + 6 + k * 3.2 - 3, y0 + 2 + 7.5 * 0.5, 1, groove);
  }
  // Clip to the diamond
  ctx.globalCompositeOperation = 'destination-in';
  poly(ctx, [16, 1, 30, 8, 16, 15, 2, 8], '#000');
  ctx.globalCompositeOperation = 'source-over';
  crisp(cv);
  return cv;
}

function cursor(colour: string): Cv {
  const cv = makeCanvas(34, 18);
  const ctx = cv.ctx;
  ctx.fillStyle = colour;
  // Corner brackets of the diamond
  const pts: [number, number][] = [[17, 1], [33, 9], [17, 17], [1, 9]];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % 4];
    for (let t = 0; t <= 1.0001; t += 1 / 16) {
      if (t > 0.3 && t < 0.7) continue;
      ctx.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
    }
  }
  return cv;
}

function splat(v: number): Cv {
  const rng = mulberry32(1200 + v);
  const cv = makeCanvas(20, 12);
  const ctx = cv.ctx;
  for (let i = 0; i < 7; i++) ellipse(ctx, 10 + (rng() - 0.5) * 12, 6 + (rng() - 0.5) * 6, 1 + rng() * 2.5, 0.8 + rng() * 1.4, i % 3 ? '#5a1414' : '#7a1c18');
  crisp(cv);
  return cv;
}

function droplet(c: string): Cv {
  const cv = makeCanvas(2, 2);
  cv.ctx.fillStyle = c;
  cv.ctx.fillRect(0, 0, 2, 2);
  return cv;
}

export function paintFarm(atlas: Atlas): void {
  for (const def of Object.values(CROPS)) {
    for (let s = 0; s <= 4; s++) {
      atlas.add(`crop:${def.id}:${s}`, paintCrop(def, s, false, false), 12, 30);
      if (s >= 2) atlas.add(`crop:${def.id}:${s}:t`, paintCrop(def, s, true, false), 12, 30);
    }
    atlas.add(`crop:${def.id}:dead`, paintCrop(def, 3, false, true), 12, 30);
  }
  atlas.add('soil:dry', tilled(false), 16, 8);
  atlas.add('soil:wet', tilled(true), 16, 8);
  atlas.add('cursor:ok', cursor('#f0e6c8'), 17, 9);
  atlas.add('cursor:bad', cursor('#d05040'), 17, 9);
  atlas.add('cursor:place', cursor('#90d070'), 17, 9);
  for (let v = 0; v < 4; v++) atlas.add(`splat:${v}`, splat(v), 10, 6);
  for (const [n, c] of [['dust', '#9a8a6a'], ['soil', '#4a3626'], ['water', '#8ac0d8'], ['chip', '#a88a5a'], ['blood', '#8a1c18'], ['spark', '#ffe080'], ['leaf', '#6a8a3a'], ['stone', '#8a857a'], ['white', '#ffffff']] as [string, string][]) {
    atlas.add(`p:${n}`, droplet(c), 1, 1);
  }
}
