// Code-drawn props and buildings. Every texture is anchored at the centre of its footprint on the ground.
import { mulberry32, Rng } from '../core/rng';
import { Atlas } from './atlas';
import { Iso3, cylinder, faces } from './iso3';
import { Cv, crisp, ellipse, line, makeCanvas, mix, outline, poly, px, shade, speckle } from './pixel';

function finish(cv: Cv, rng?: Rng, grain = 0): Cv {
  crisp(cv);
  if (rng && grain) speckle(cv, rng, grain, 0.35);
  outline(cv);
  return cv;
}

// ---------------------------------------------------------------- nature

function deadTree(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(100 + v);
  const cv = makeCanvas(44, 60);
  const ctx = cv.ctx;
  const bx = 22;
  const by = 55;
  const bark = ['#4b3e33', '#5e4e40', '#76634f'];
  const h = 22 + v * 4;
  // Trunk, slightly leaning
  const lean = (rng() - 0.5) * 4;
  poly(ctx, [bx - 3, by, bx + 3, by, bx + 1.5 + lean, by - h, bx - 1.5 + lean, by - h], bark[1]);
  poly(ctx, [bx - 3, by, bx - 1, by, bx - 0.5 + lean, by - h, bx - 1.5 + lean, by - h], bark[2]);
  poly(ctx, [bx + 1.5, by, bx + 3, by, bx + 1.5 + lean, by - h, bx + 0.8 + lean, by - h], bark[0]);
  // Roots
  line(ctx, bx - 3, by, bx - 6, by + 1, 1.5, bark[1]);
  line(ctx, bx + 3, by, bx + 6, by + 1.5, 1.5, bark[0]);
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    line(ctx, x, y, x2, y2, w, ang < -Math.PI / 2 ? bark[2] : bark[1]);
    if (depth <= 0 || len < 3) return;
    const n = 2;
    for (let i = 0; i < n; i++) {
      const a = ang + (i === 0 ? -1 : 1) * (0.35 + rng() * 0.45);
      branch(x2, y2, a, len * (0.6 + rng() * 0.2), Math.max(1, w - 0.6), depth - 1);
    }
  };
  const tx = bx + lean;
  const ty = by - h;
  branch(tx, ty, -Math.PI / 2 - 0.5 - rng() * 0.3, 10 + v, 2.2, 3);
  branch(tx, ty, -Math.PI / 2 + 0.5 + rng() * 0.3, 9 + v, 2.2, 3);
  branch(tx - 0.5, ty + 6, -Math.PI / 2 - 1.1, 7, 1.6, 2);
  finish(cv, rng, 0.1);
  return { cv, ax: bx, ay: by };
}

function pine(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(200 + v);
  const cv = makeCanvas(44, 72);
  const ctx = cv.ctx;
  const bx = 22;
  const by = 67;
  const tiers = 5 + (v % 2);
  const height = 50 + v * 5;
  poly(ctx, [bx - 2, by, bx + 2, by, bx + 1.5, by - 12, bx - 1.5, by - 12], '#4a3a2c');
  px(ctx, bx - 2, by - 12, '#5e4a38', 1, 12);
  const greens = ['#22362a', '#2c4532', '#38563a', '#4a6b44'];
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const base = by - 8 - t * (height - 18);
    const half = 15 - t * 10 + (rng() - 0.5) * 2;
    const top = base - 14 + t * 2;
    const off = (rng() - 0.5) * 2;
    poly(ctx, [bx - half + off, base, bx + half + off, base + 1, bx + off * 0.3, top], greens[1]);
    // Lit left edge and a dark right edge
    poly(ctx, [bx - half + off, base, bx - half * 0.35 + off, base, bx + off * 0.3, top], greens[2]);
    poly(ctx, [bx + half * 0.4 + off, base + 1, bx + half + off, base + 1, bx + off * 0.3, top], greens[0]);
    // A few needle highlights
    for (let k = 0; k < 4; k++) px(ctx, bx - half * 0.6 + rng() * half * 0.8 + off, base - 2 - rng() * 6, greens[3]);
  }
  finish(cv, rng, 0.08);
  return { cv, ax: bx, ay: by };
}

function saltbush(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(300 + v);
  const cv = makeCanvas(26, 22);
  const ctx = cv.ctx;
  const cols = ['#4c5640', '#5f6b4f', '#76835f', '#8f9b74'];
  const blobs = 6 + v;
  for (let i = 0; i < blobs; i++) {
    const x = 13 + (rng() - 0.5) * 12;
    const y = 15 - rng() * 7;
    const r = 3 + rng() * 2.5;
    ellipse(ctx, x, y, r, r * 0.85, cols[1]);
    ellipse(ctx, x - r * 0.3, y - r * 0.35, r * 0.55, r * 0.45, cols[2]);
  }
  for (let i = 0; i < 6; i++) px(ctx, 6 + rng() * 14, 6 + rng() * 9, cols[3]);
  for (let i = 0; i < 5; i++) px(ctx, 9 + rng() * 10, 13 + rng() * 4, cols[0]);
  finish(cv);
  return { cv, ax: 13, ay: 18 };
}

function rock(v: number, big: boolean): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(400 + v + (big ? 50 : 0));
  const W = big ? 36 : 24;
  const H = big ? 30 : 19;
  const cv = makeCanvas(W, H);
  const ctx = cv.ctx;
  const cx = W / 2;
  const cy = H - 5;
  const rx = big ? 13 : 8;
  const ry = big ? 7 : 4.5;
  const hgt = big ? 14 : 7;
  const base = ['#57534d', '#6d6860', '#86817a', '#a09b92'];
  const pts: number[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.8 + rng() * 0.3;
    const up = Math.sin(a) < 0 ? hgt * (0.7 + rng() * 0.4) : 0;
    pts.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r - up);
  }
  poly(ctx, pts, base[1]);
  // Lit top face
  const top: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    top.push(cx - 1 + Math.cos(a) * rx * 0.6, cy - hgt * 0.75 + Math.sin(a) * ry * 0.5);
  }
  poly(ctx, top, base[2]);
  // Shadow side
  poly(ctx, [cx + rx * 0.3, cy + ry * 0.9, cx + rx, cy, cx + rx * 0.8, cy - hgt * 0.6, cx + rx * 0.2, cy - hgt * 0.3], base[0]);
  for (let i = 0; i < 5; i++) px(ctx, cx - rx * 0.6 + rng() * rx, cy - hgt * 0.8 + rng() * ry, base[3]);
  if (big) line(ctx, cx - 2, cy - hgt * 0.7, cx + 3, cy - 1, 1, base[0]);
  finish(cv, rng, 0.08);
  return { cv, ax: cx, ay: cy };
}

function weed(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(500 + v);
  const cv = makeCanvas(14, 12);
  const ctx = cv.ctx;
  const g = ['#4a5e2c', '#61783a', '#7d944a'];
  for (let i = 0; i < 6 + v; i++) {
    const x = 7 + (rng() - 0.5) * 8;
    line(ctx, 7, 10, x, 3 + rng() * 4, 1, g[Math.floor(rng() * 3)]);
  }
  if (v === 2) px(ctx, 6, 3, '#c8b04a', 2, 2);
  finish(cv);
  return { cv, ax: 7, ay: 10 };
}

// ---------------------------------------------------------------- salvage and ruins

function scrapPile(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(600 + v);
  const cv = makeCanvas(30, 22);
  const ctx = cv.ctx;
  const rust = ['#5b2f1d', '#7a4026', '#9a5630', '#b06c3c'];
  const steel = ['#4f5357', '#676c71', '#868b8f'];
  // Base heap
  ellipse(ctx, 15, 16, 12, 5, '#4a3a2e');
  for (let i = 0; i < 8; i++) {
    const x = 5 + rng() * 18;
    const y = 8 + rng() * 9;
    const w = 4 + rng() * 6;
    const h = 2 + rng() * 3;
    const r = rng() < 0.6;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rng() - 0.5) * 1.2);
    ctx.fillStyle = r ? rust[1 + Math.floor(rng() * 3)] : steel[Math.floor(rng() * 3)];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = r ? rust[0] : steel[0];
    ctx.fillRect(-w / 2, h / 2 - 1, w, 1);
    ctx.restore();
  }
  // A tyre
  if (v !== 1) {
    ellipse(ctx, 21, 14, 4, 3, '#1f1d1c');
    ellipse(ctx, 21, 14, 1.6, 1.2, '#4a3a2e');
  }
  // A bent pipe
  line(ctx, 6, 9, 13, 5, 1.5, steel[2]);
  finish(cv, rng, 0.12);
  return { cv, ax: 15, ay: 17 };
}

function ruinWall(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(700 + v);
  const H = [14, 22, 30][v];
  const iso = new Iso3(1, 1, H + 6);
  const conc = faces('#7d786e', 0.16, -0.3);
  iso.box(0, 0, 0, 1, 1, H, conc);
  // Courses
  iso.leftLines(0, 1, 0, 1, H, 6, shade('#7d786e', -0.12));
  iso.rightLines(1, 0, 0, 1, H, 6, shade('#7d786e', -0.4));
  // Broken top: knock notches out
  const ctx = iso.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 3; i++) {
    const t = rng();
    const [x, y] = iso.p(t, t < 0.5 ? 0.0 : 1, H);
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 3 + rng() * 3, 2 + rng() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Rebar
  const [rx, ry] = iso.p(0.7, 1, H - 2);
  line(ctx, rx, ry, rx + 1, ry - 6, 1, '#5b3a28');
  // Stains
  for (let i = 0; i < 6; i++) {
    const [sx, sy] = iso.p(rng(), 1, rng() * H);
    px(ctx, sx, sy, '#5d584f', 1, 2 + Math.floor(rng() * 3));
  }
  finish(iso.cv, rng, 0.1);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function wreck(v: number): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(800 + v);
  const iso = new Iso3(2, 1, 24);
  const paint = ['#6b3b2b', '#3f5a62', '#7a6a3a'][v];
  const body = faces(mix(paint, '#6a3a22', 0.35), 0.15, -0.3);
  // Chassis sits low, no wheels
  iso.box(0.05, 0.12, 1, 1.9, 0.76, 7, body);
  // Cabin
  iso.box(0.55, 0.2, 8, 0.85, 0.6, 6, faces(mix(paint, '#6a3a22', 0.5), 0.1, -0.35));
  // Dark windows
  iso.quad([[0.62, 0.8, 9], [1.33, 0.8, 9], [1.33, 0.8, 13], [0.62, 0.8, 13]], '#1d2226');
  iso.quad([[1.4, 0.25, 9], [1.4, 0.75, 9], [1.4, 0.75, 13], [1.4, 0.25, 13]], '#161a1d');
  // Rust holes
  const ctx = iso.ctx;
  for (let i = 0; i < 10; i++) {
    const [x, y] = iso.p(0.1 + rng() * 1.8, 0.88, 1 + rng() * 6);
    px(ctx, x, y, rng() < 0.5 ? '#4a2416' : '#8a4a28', 2, 1);
  }
  // Wheel arches as dark gaps
  for (const t of [0.35, 1.6]) {
    const [x, y] = iso.p(t, 0.88, 1);
    ellipse(ctx, x, y, 3, 2, '#141414');
  }
  finish(iso.cv, rng, 0.12);
  const [ax, ay] = iso.anchor(1, 0.5);
  return { cv: iso.cv, ax, ay };
}

// ---------------------------------------------------------------- buildings

function farmhouse(): { cv: Cv; ax: number; ay: number } {
  const rng = mulberry32(900);
  const iso = new Iso3(4, 4, 84, 6);
  const ctx = iso.ctx;
  // Plinth
  iso.box(0, 0, 0, 4, 4, 4, faces('#6b665d', 0.12, -0.3));
  // Lower walls: Meridian concrete
  const wall = '#9a948a';
  iso.box(0.25, 0.25, 4, 3.5, 3.5, 14, faces(wall, 0.1, -0.3));
  iso.leftLines(0.25, 3.75, 4, 3.5, 14, 5, shade(wall, -0.1));
  iso.rightLines(3.75, 0.25, 4, 3.5, 14, 5, shade(wall, -0.38));
  // Upper walls: weatherboard added later
  const board = '#7a6248';
  iso.quad([[0.25, 3.75, 18], [3.75, 3.75, 18], [3.75, 3.75, 30], [0.25, 3.75, 30]], board);
  iso.quad([[3.75, 0.25, 18], [3.75, 3.75, 18], [3.75, 3.75, 30], [3.75, 0.25, 30]], shade(board, -0.3));
  iso.leftLines(0.25, 3.75, 18, 3.5, 12, 3, shade(board, -0.18));
  iso.rightLines(3.75, 0.25, 18, 3.5, 12, 3, shade(board, -0.45));
  // Windows on the south-west face, part boarded
  for (const wx of [0.7, 2.4]) {
    iso.quad([[wx, 3.76, 19], [wx + 0.7, 3.76, 19], [wx + 0.7, 3.76, 27], [wx, 3.76, 27]], '#5a4632');
    iso.quad([[wx + 0.08, 3.77, 20], [wx + 0.62, 3.77, 20], [wx + 0.62, 3.77, 26], [wx + 0.08, 3.77, 26]], '#1b2228');
    iso.seg([wx + 0.05, 3.78, 22], [wx + 0.65, 3.78, 24.5], '#8a6e50', 2);
  }
  // Door and a window on the east face (toward the field)
  iso.quad([[3.76, 1.5, 4], [3.76, 2.3, 4], [3.76, 2.3, 20], [3.76, 1.5, 20]], '#3a2c20');
  iso.quad([[3.77, 1.6, 5], [3.77, 2.2, 5], [3.77, 2.2, 19], [3.77, 1.6, 19]], '#5c4330');
  iso.seg([3.78, 2.1, 12], [3.78, 2.1, 12], '#c8a050', 1);
  iso.quad([[3.76, 2.75, 19], [3.76, 3.4, 19], [3.76, 3.4, 26], [3.76, 2.75, 26]], '#4a3828');
  iso.quad([[3.77, 2.82, 20], [3.77, 3.33, 20], [3.77, 3.33, 25], [3.77, 2.82, 25]], '#1b2228');
  // Porch on the east side: posts and a lean-to awning
  for (const py of [0.6, 3.4]) iso.box(4.35, py, 4, 0.12, 0.12, 22, faces('#5a4632', 0.1, -0.3));
  iso.quad([[3.75, 0.3, 30], [3.75, 3.7, 30], [4.6, 3.7, 25], [4.6, 0.3, 25]], '#6f4a33');
  for (let k = 0.5; k < 3.7; k += 0.35) iso.seg([3.76, k, 30], [4.58, k, 25], '#5a3a28');
  // Corrugated iron roof, ridge along y, with patched sheets
  const roof = '#7d4f38';
  iso.gableY(0.25, 0.25, 30, 3.5, 3.5, 22, roof, shade(board, -0.05), 0.3);
  const ridgeLines = (x0: number, x1: number, z0: number, z1: number, c: string) => {
    for (let k = 0.05; k < 3.85; k += 0.22) iso.seg([x0, k, z0], [x1, k, z1], c);
  };
  ridgeLines(2.0, 4.05, 52, 30, shade(roof, -0.4));
  // Patches
  iso.quad([[2.6, 0.6, 44], [2.6, 1.4, 44], [3.3, 1.4, 36], [3.3, 0.6, 36]], '#8a8478');
  iso.quad([[2.2, 2.6, 48], [2.2, 3.2, 48], [2.9, 3.2, 40], [2.9, 2.6, 40]], '#5f6a6e');
  // Chimney pipe
  const [cx, cy] = iso.p(1.2, 1.0, 50);
  ctx.fillStyle = '#3b3a38';
  ctx.fillRect(cx - 1, cy - 12, 3, 12);
  ctx.fillStyle = '#56544f';
  ctx.fillRect(cx - 2, cy - 13, 5, 2);
  // Weathering
  for (let i = 0; i < 30; i++) {
    const [sx, sy] = iso.p(0.3 + rng() * 3.4, 3.76, 4 + rng() * 13);
    px(ctx, sx, sy, rng() < 0.5 ? '#7d776c' : '#6f6a60', 1, 1 + Math.floor(rng() * 3));
  }
  finish(iso.cv, rng, 0.06);
  const [ax, ay] = iso.anchor(2, 2);
  return { cv: iso.cv, ax, ay };
}

function well(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 44);
  const ctx = iso.ctx;
  const [bx, by] = iso.anchor(0.5, 0.5);
  cylinder(iso.cv, bx, by, 11, 8, '#7a746a', '#8d877c');
  ellipse(ctx, bx, by - 8, 8, 4, '#16252a');
  // Stone courses
  for (let i = -9; i <= 9; i += 4) px(ctx, bx + i, by - 4 + Math.abs(i) * 0.15, '#5f5a52', 1, 3);
  // Frame and roof
  const wood = '#5a4632';
  ctx.fillStyle = wood;
  ctx.fillRect(bx - 10, by - 30, 2, 26);
  ctx.fillRect(bx + 8, by - 30, 2, 26);
  ctx.fillRect(bx - 11, by - 26, 22, 2);
  poly(ctx, [bx - 14, by - 29, bx, by - 38, bx + 14, by - 29, bx, by - 22], '#6f4a33');
  poly(ctx, [bx, by - 38, bx + 14, by - 29, bx, by - 22], '#5a3a28');
  // Rope and bucket
  line(ctx, bx, by - 25, bx, by - 14, 1, '#b8a070');
  ctx.fillStyle = '#5f6a6e';
  ctx.fillRect(bx - 2, by - 14, 5, 4);
  finish(iso.cv);
  return { cv: iso.cv, ax: bx, ay: by };
}

function crate(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 30);
  iso.box(0.05, 0.05, 0, 0.9, 0.9, 2, faces('#5a4632', 0.1, -0.3));
  const wood = '#8a6a44';
  iso.box(0.12, 0.12, 2, 0.76, 0.76, 13, faces(wood, 0.14, -0.3));
  iso.leftLines(0.12, 0.88, 2, 0.76, 13, 3, shade(wood, -0.18));
  iso.rightLines(0.88, 0.12, 2, 0.76, 13, 3, shade(wood, -0.45));
  // Steel bands
  iso.seg([0.12, 0.89, 4], [0.88, 0.89, 4], '#4f5357');
  iso.seg([0.12, 0.89, 12], [0.88, 0.89, 12], '#4f5357');
  iso.seg([0.89, 0.12, 4], [0.89, 0.88, 4], '#3b3e42');
  iso.seg([0.89, 0.12, 12], [0.89, 0.88, 12], '#3b3e42');
  // Stencil mark
  const [sx, sy] = iso.p(0.45, 0.89, 9);
  px(iso.ctx, sx - 2, sy, '#d8c8a0', 5, 1);
  px(iso.ctx, sx, sy - 2, '#d8c8a0', 1, 5);
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function radio(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 76);
  const ctx = iso.ctx;
  iso.box(0.2, 0.25, 0, 0.6, 0.5, 9, faces('#4a5a48', 0.14, -0.32));
  iso.quad([[0.3, 0.76, 3], [0.6, 0.76, 3], [0.6, 0.76, 7], [0.3, 0.76, 7]], '#2a3028');
  const [bx, by] = iso.p(0.5, 0.5, 9);
  const top = by - 58;
  ctx.fillStyle = '#5c5f62';
  ctx.fillRect(bx - 3, top, 1, by - top);
  ctx.fillRect(bx + 2, top, 1, by - top);
  for (let y = by; y > top; y -= 5) line(ctx, bx - 3, y, bx + 2, y - 5, 1, '#6f7376');
  // Cross arms and a dish
  ctx.fillRect(bx - 7, top + 4, 14, 1);
  ellipse(ctx, bx + 6, top + 14, 3, 4, '#8b8f92');
  ctx.fillStyle = '#c03a2a';
  ctx.fillRect(bx - 1, top - 2, 3, 2);
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function campfire(): { cv: Cv; ax: number; ay: number } {
  const cv = makeCanvas(22, 14);
  const ctx = cv.ctx;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ellipse(ctx, 11 + Math.cos(a) * 8, 8 + Math.sin(a) * 4, 2.2, 1.6, i % 2 ? '#6d6860' : '#86817a');
  }
  line(ctx, 6, 9, 15, 6, 2, '#3a2a1e');
  line(ctx, 6, 6, 15, 9, 2, '#4a3626');
  px(ctx, 9, 7, '#1a1410', 4, 2);
  finish(cv);
  return { cv, ax: 11, ay: 9 };
}

function flame(f: number): Cv {
  const cv = makeCanvas(12, 16);
  const ctx = cv.ctx;
  const rng = mulberry32(950 + f);
  const sway = Math.sin(f * 1.7) * 1.5;
  poly(ctx, [2, 15, 10, 15, 6 + sway, 2 + rng() * 2], '#d8541e');
  poly(ctx, [3.5, 15, 8.5, 15, 6 + sway * 0.6, 6 + rng() * 2], '#f0a030');
  poly(ctx, [5, 15, 7.5, 15, 6 + sway * 0.3, 10], '#fff0a0');
  crisp(cv);
  return cv;
}

// ---------------------------------------------------------------- things you build

/** Fence connection mask: 1 = +x neighbour, 2 = +y, 4 = -x, 8 = -y. */
function fence(mask: number, gate: boolean): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 22);
  const wood = '#6f5a44';
  const f = faces(wood, 0.15, -0.3);
  const rail = (x0: number, y0: number, x1: number, y1: number) => {
    for (const z of [4, 9]) {
      const ax = Math.min(x0, x1);
      const ay = Math.min(y0, y1);
      const w = Math.max(0.06, Math.abs(x1 - x0));
      const d = Math.max(0.06, Math.abs(y1 - y0));
      iso.box(ax, ay, z, w, d, 1.5, f);
    }
  };
  const panel = (alongX: boolean) => {
    const c = gate ? '#7d6448' : wood;
    if (alongX) {
      iso.box(0, 0.46, 2, 1, 0.08, 10, faces(c, 0.15, -0.3));
      for (let k = 0.15; k < 1; k += 0.2) iso.seg([k, 0.55, 2], [k, 0.55, 12], shade(c, -0.25));
      iso.seg([0.05, 0.55, 3], [0.95, 0.55, 11], shade(c, -0.35));
    } else {
      iso.box(0.46, 0, 2, 0.08, 1, 10, faces(c, 0.15, -0.3));
      for (let k = 0.15; k < 1; k += 0.2) iso.seg([0.55, k, 2], [0.55, k, 12], shade(c, -0.45));
      iso.seg([0.55, 0.05, 3], [0.55, 0.95, 11], shade(c, -0.5));
    }
  };
  if (gate) {
    const alongX = (mask & 5) !== 0 || (mask & 10) === 0;
    // posts at both ends
    if (alongX) {
      iso.box(-0.04, 0.44, 0, 0.12, 0.12, 14, f);
      panel(true);
      iso.box(0.92, 0.44, 0, 0.12, 0.12, 14, f);
    } else {
      iso.box(0.44, -0.04, 0, 0.12, 0.12, 14, f);
      panel(false);
      iso.box(0.44, 0.92, 0, 0.12, 0.12, 14, f);
    }
  } else {
    if (mask & 4) rail(0, 0.48, 0.5, 0.52);
    if (mask & 8) rail(0.48, 0, 0.52, 0.5);
    iso.box(0.42, 0.42, 0, 0.16, 0.16, 13, f);
    iso.box(0.4, 0.4, 13, 0.2, 0.2, 1, faces('#5a4632', 0.2, -0.2));
    if (mask & 1) rail(0.5, 0.48, 1, 0.52);
    if (mask & 2) rail(0.48, 0.5, 0.52, 1);
  }
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function lamp(on: boolean): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 50);
  const ctx = iso.ctx;
  iso.box(0.35, 0.35, 0, 0.3, 0.3, 3, faces('#4f5357', 0.15, -0.3));
  const [bx, by] = iso.p(0.5, 0.5, 3);
  ctx.fillStyle = '#3b3e42';
  ctx.fillRect(bx - 1, by - 36, 2, 36);
  ctx.fillStyle = '#55595d';
  ctx.fillRect(bx - 1, by - 36, 1, 36);
  ctx.fillStyle = '#3b3e42';
  ctx.fillRect(bx - 1, by - 37, 7, 2);
  // Lamp head: a salvaged hurricane lamp
  ctx.fillStyle = '#2a2c2e';
  ctx.fillRect(bx + 3, by - 36, 5, 2);
  ctx.fillStyle = on ? '#ffe7a0' : '#6b6a5a';
  ctx.fillRect(bx + 3, by - 34, 5, 5);
  if (on) {
    ctx.fillStyle = '#fff6d0';
    ctx.fillRect(bx + 5, by - 33, 1, 3);
  }
  ctx.fillStyle = '#2a2c2e';
  ctx.fillRect(bx + 3, by - 29, 5, 1);
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function compostBin(ready: boolean): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 18);
  const wood = '#6f5a44';
  iso.box(0.12, 0.12, 0, 0.76, 0.76, 11, faces(wood, 0.15, -0.3));
  iso.leftLines(0.12, 0.88, 0, 0.76, 11, 3, '#4a3a2c');
  iso.rightLines(0.88, 0.12, 0, 0.76, 11, 3, '#3a2c20');
  iso.quad([[0.2, 0.2, 11], [0.8, 0.2, 11], [0.8, 0.8, 11], [0.2, 0.8, 11]], ready ? '#2e2218' : '#4a3a2c');
  if (ready) {
    const [x, y] = iso.p(0.5, 0.5, 11);
    px(iso.ctx, x - 3, y - 1, '#5a7a30', 2, 1);
    px(iso.ctx, x + 2, y, '#5a7a30', 1, 1);
  }
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function bunk(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 30);
  const wood = '#5a4632';
  for (const [x, y] of [[0.12, 0.15], [0.8, 0.15], [0.12, 0.78], [0.8, 0.78]]) iso.box(x, y, 0, 0.08, 0.08, 6, faces(wood, 0.1, -0.3));
  iso.box(0.1, 0.12, 5, 0.82, 0.76, 2, faces(wood, 0.12, -0.3));
  iso.box(0.12, 0.14, 7, 0.78, 0.72, 2, faces('#8a3a2c', 0.12, -0.3));
  iso.box(0.14, 0.16, 9, 0.22, 0.68, 2, faces('#c8c0a8', 0.1, -0.25));
  // Canvas awning on two poles
  iso.box(0.05, 0.05, 0, 0.06, 0.06, 22, faces(wood, 0.1, -0.3));
  iso.box(0.05, 0.9, 0, 0.06, 0.06, 22, faces(wood, 0.1, -0.3));
  iso.quad([[0.05, 0.0, 22], [0.05, 1.0, 22], [0.7, 1.0, 15], [0.7, 0.0, 15]], '#8a8060');
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function rainBarrel(full: boolean): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 24);
  const [bx, by] = iso.anchor(0.5, 0.5);
  cylinder(iso.cv, bx, by, 7, 14, '#4f6670', full ? '#3a6a80' : '#36454c');
  const ctx = iso.ctx;
  ctx.fillStyle = '#3b4a52';
  ctx.fillRect(bx - 7, by - 4, 14, 1);
  ctx.fillRect(bx - 7, by - 10, 14, 1);
  if (full) px(ctx, bx - 2, by - 15, '#8ac0d0', 3, 1);
  finish(iso.cv);
  return { cv: iso.cv, ax: bx, ay: by };
}

function spikeTrap(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 10);
  iso.box(0.15, 0.15, 0, 0.7, 0.7, 1, faces('#4a3a2c', 0.1, -0.3));
  const ctx = iso.ctx;
  for (let i = 0.25; i < 0.85; i += 0.2)
    for (let j = 0.25; j < 0.85; j += 0.2) {
      const [x, y] = iso.p(i, j, 1);
      px(ctx, x, y - 3, '#a8acb0', 1, 3);
      px(ctx, x, y - 4, '#e0e4e8', 1, 1);
    }
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

function sprinkler(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 14);
  const [bx, by] = iso.anchor(0.5, 0.5);
  const ctx = iso.ctx;
  ellipse(ctx, bx, by, 4, 2, '#4f5357');
  ctx.fillStyle = '#6f7376';
  ctx.fillRect(bx - 1, by - 7, 2, 7);
  ctx.fillStyle = '#c8a050';
  ctx.fillRect(bx - 3, by - 9, 6, 2);
  ctx.fillStyle = '#e8c870';
  ctx.fillRect(bx - 3, by - 9, 2, 1);
  finish(iso.cv);
  return { cv: iso.cv, ax: bx, ay: by };
}

function papers(): { cv: Cv; ax: number; ay: number } {
  const cv = makeCanvas(16, 10);
  const ctx = cv.ctx;
  poly(ctx, [2, 5, 9, 2, 14, 5, 7, 8], '#d8ccb0');
  poly(ctx, [4, 6, 10, 3, 13, 5, 7, 8], '#e8dec4');
  px(ctx, 6, 5, '#7a6a50', 4, 1);
  px(ctx, 7, 6, '#7a6a50', 3, 1);
  finish(cv);
  return { cv, ax: 8, ay: 6 };
}

function coop(): { cv: Cv; ax: number; ay: number } {
  const iso = new Iso3(1, 1, 30);
  const wood = '#7a5e44';
  // Raised hutch on legs with a ramp
  for (const [x, y] of [[0.12, 0.12], [0.8, 0.12], [0.12, 0.8], [0.8, 0.8]]) iso.box(x, y, 0, 0.08, 0.08, 6, faces('#5a4632', 0.1, -0.3));
  iso.box(0.08, 0.08, 6, 0.86, 0.86, 10, faces(wood, 0.14, -0.3));
  iso.leftLines(0.08, 0.94, 6, 0.86, 10, 2.5, shade(wood, -0.18));
  iso.rightLines(0.94, 0.08, 6, 0.86, 10, 2.5, shade(wood, -0.45));
  iso.quad([[0.35, 0.95, 7], [0.6, 0.95, 7], [0.6, 0.95, 12], [0.35, 0.95, 12]], '#1e1610');
  iso.gableX(0.08, 0.08, 16, 0.86, 0.86, 7, '#6a4030', shade(wood, -0.1), 0.08);
  // Ramp
  iso.quad([[0.38, 0.95, 7], [0.58, 0.95, 7], [0.58, 1.3, 0], [0.38, 1.3, 0]], '#8a6a4a');
  finish(iso.cv);
  const [ax, ay] = iso.anchor(0.5, 0.5);
  return { cv: iso.cv, ax, ay };
}

/** A hen. dir 0..7 clockwise from east; anim walk/peck/idle. */
function hen(dir: number, anim: 'idle' | 'walk' | 'peck', f: number): Cv {
  const cv = makeCanvas(18, 16);
  const ctx = cv.ctx;
  const a = (dir * Math.PI) / 4;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const cx = 9;
  const cy = 10;
  const body = '#c8a878';
  const dark = '#8a6a48';
  // Legs
  const step = anim === 'walk' ? (f % 2 ? 1 : -1) : 0;
  ctx.fillStyle = '#d89a30';
  ctx.fillRect(Math.round(cx - 1 + step * 0.5), cy + 2, 1, 3);
  ctx.fillRect(Math.round(cx + 1 - step * 0.5), cy + 2, 1, 3);
  // Tail behind
  const tx = cx - fx * 4;
  const ty = cy - fy * 2 - 3;
  const drawTail = () => ellipse(ctx, tx, ty, 2, 2.6, dark);
  // Head in front
  const peck = anim === 'peck' && f % 2 === 0;
  const hx = cx + fx * 4;
  const hy = cy + fy * 2 - (peck ? 0 : 5);
  const drawHead = () => {
    ellipse(ctx, hx, hy, 2.2, 2.2, body);
    ctx.fillStyle = '#c83a2a';
    ctx.fillRect(Math.round(hx - 1), Math.round(hy - 3), 2, 2);
    ctx.fillStyle = '#e0a030';
    ctx.fillRect(Math.round(hx + fx * 2), Math.round(hy + fy * 1), 2, 1);
    if (fy > -0.5) {
      ctx.fillStyle = '#1a1410';
      ctx.fillRect(Math.round(hx + fx * 0.8), Math.round(hy - 0.5), 1, 1);
    }
  };
  if (fy > 0) drawTail();
  else drawHead();
  ellipse(ctx, cx, cy, 4.2, 3.2, body);
  ellipse(ctx, cx - fy * 1.2, cy - 0.5, 2.4, 1.6, shade(body, 0.15));
  px(ctx, cx + 1, cy + 1, dark, 2, 1);
  if (fy > 0) drawHead();
  else drawTail();
  crisp(cv);
  outline(cv);
  return cv;
}

function shadowTex(rx: number, ry: number): Cv {
  const cv = makeCanvas(rx * 2 + 2, ry * 2 + 2);
  ellipse(cv.ctx, rx + 1, ry + 1, rx, ry, '#000000');
  crisp(cv);
  return cv;
}

/** Soft radial light, used on the light map (not pixel art, it is never seen directly). */
function lightTex(size: number): Cv {
  const cv = makeCanvas(size, size);
  const g = cv.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cv.ctx.fillStyle = g;
  cv.ctx.fillRect(0, 0, size, size);
  return cv;
}

export function paintProps(atlas: Atlas): void {
  const add = (name: string, r: { cv: Cv; ax: number; ay: number }) => atlas.add(name, r.cv, r.ax, r.ay);
  for (let v = 0; v < 3; v++) {
    add(`obj:tree_dead:${v}`, deadTree(v));
    add(`obj:tree_pine:${v}`, pine(v));
    add(`obj:saltbush:${v}`, saltbush(v));
    add(`obj:rock:${v}`, rock(v, false));
    add(`obj:scrap_pile:${v}`, scrapPile(v));
    add(`obj:ruin_wall:${v}`, ruinWall(v));
    add(`obj:wreck:${v}`, wreck(v));
    add(`obj:weed:${v}`, weed(v));
  }
  for (let v = 0; v < 2; v++) add(`obj:boulder:${v}`, rock(v, true));
  add('obj:farmhouse:0', farmhouse());
  add('obj:well:0', well());
  add('obj:crate:0', crate());
  add('obj:radio:0', radio());
  add('obj:campfire:0', campfire());
  for (let f = 0; f < 4; f++) atlas.add(`fire:${f}`, flame(f), 6, 15);
  for (let m = 0; m < 16; m++) {
    add(`fence:${m}`, fence(m, false));
    add(`gate:${m}`, fence(m, true));
  }
  add('obj:lamp:0', lamp(false));
  add('obj:lamp:on', lamp(true));
  add('obj:compost_bin:0', compostBin(false));
  add('obj:compost_bin:ready', compostBin(true));
  add('obj:bunk:0', bunk());
  add('obj:rain_barrel:0', rainBarrel(false));
  add('obj:rain_barrel:full', rainBarrel(true));
  add('obj:spike_trap:0', spikeTrap());
  add('obj:sprinkler:0', sprinkler());
  add('obj:document:0', papers());
  add('obj:coop:0', coop());
  for (let d = 0; d < 8; d++) {
    for (let f = 0; f < 2; f++) {
      atlas.add(`hen:walk:${d}:${f}`, hen(d, 'walk', f), 9, 15);
      atlas.add(`hen:peck:${d}:${f}`, hen(d, 'peck', f), 9, 15);
    }
    atlas.add(`hen:idle:${d}:0`, hen(d, 'idle', 0), 9, 15);
  }
  for (const [n, rx, ry] of [['s', 5, 2], ['m', 8, 4], ['l', 13, 6], ['xl', 40, 20]] as [string, number, number][]) {
    const c = shadowTex(rx, ry);
    atlas.add(`shadow:${n}`, c, c.w / 2, c.h / 2);
  }
  const l = lightTex(128);
  atlas.add('light', l, 64, 64);
}
