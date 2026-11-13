// 16 by 16 item icons, drawn in code. The UI shows them as scaled-up images.
import { CROPS, ITEMS } from '../data';
import { Cv, crisp, ellipse, line, makeCanvas, outline, poly, px, shade } from './pixel';

function base(): Cv {
  return makeCanvas(16, 16);
}

function seedPacket(colour: string): Cv {
  const cv = base();
  const c = cv.ctx;
  poly(c, [3, 3, 13, 3, 13, 14, 3, 14], '#d8c8a0');
  poly(c, [3, 3, 13, 3, 13, 5, 3, 5], '#b8a880');
  ellipse(c, 8, 9.5, 3, 3, colour);
  px(c, 7, 8, shade(colour, 0.4), 1, 1);
  px(c, 4, 12, '#8a7a5a', 8, 1);
  return cv;
}

function produce(id: string): Cv {
  const def = CROPS[id];
  const cv = base();
  const c = cv.ctx;
  const f = def.fruit;
  const lf = def.leaf;
  switch (id) {
    case 'radish':
      ellipse(c, 8, 10, 3.5, 3.8, f);
      line(c, 8, 13, 8, 15, 1, '#d8c8b0');
      line(c, 8, 6, 6, 2, 1.6, lf);
      line(c, 8, 6, 10, 2, 1.6, shade(lf, 0.2));
      break;
    case 'potato':
      ellipse(c, 8, 9, 5, 4, f);
      px(c, 6, 8, shade(f, -0.3));
      px(c, 9, 10, shade(f, -0.3));
      px(c, 6, 7, shade(f, 0.3), 2, 1);
      break;
    case 'kale':
      for (let i = 0; i < 5; i++) ellipse(c, 5 + i * 1.6, 7 + (i % 2) * 2, 2.6, 3.6, i % 2 ? lf : shade(lf, 0.2));
      line(c, 8, 10, 8, 15, 1.4, shade(lf, -0.2));
      break;
    case 'beans':
      for (let i = 0; i < 3; i++) line(c, 4 + i * 3, 4, 6 + i * 3, 13, 2.2, i % 2 ? f : shade(f, 0.15));
      break;
    case 'tomato':
      ellipse(c, 8, 9.5, 4.5, 4, f);
      px(c, 6, 7, shade(f, 0.4), 2, 1);
      poly(c, [6, 5, 10, 5, 8, 7], lf);
      break;
    case 'corn':
      ellipse(c, 8, 8, 2.6, 6, f);
      for (let y = 4; y < 13; y += 2) px(c, 7, y, shade(f, 0.25), 2, 1);
      line(c, 5, 14, 7, 6, 1.6, lf);
      line(c, 11, 14, 9, 6, 1.6, shade(lf, 0.2));
      break;
    case 'sunflower':
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ellipse(c, 8 + Math.cos(a) * 4.5, 8 + Math.sin(a) * 4.5, 1.8, 1.8, f);
      }
      ellipse(c, 8, 8, 3, 3, '#4a3020');
      break;
    case 'pumpkin':
      ellipse(c, 8, 9.5, 6, 4.8, f);
      line(c, 8, 5, 8, 14, 1, shade(f, -0.25));
      line(c, 5, 6, 5, 13, 1, shade(f, -0.25));
      line(c, 11, 6, 11, 13, 1, shade(f, -0.25));
      line(c, 8, 5, 9, 2, 1.5, '#5a4a2a');
      break;
  }
  return cv;
}

function tool(id: string): Cv {
  const cv = base();
  const c = cv.ctx;
  const handle = '#8a6a44';
  switch (id) {
    case 'hoe':
      line(c, 3, 14, 12, 3, 1.5, handle);
      poly(c, [10, 2, 14, 4, 14, 6, 11, 4], '#7d8186');
      break;
    case 'can':
      poly(c, [3, 7, 11, 7, 11, 14, 3, 14], '#5f7a86');
      poly(c, [3, 7, 11, 7, 11, 8, 3, 8], '#8fb0bc');
      line(c, 11, 9, 15, 5, 1.5, '#5f7a86');
      line(c, 4, 6, 9, 3, 1, '#3f5a66');
      line(c, 9, 3, 10, 7, 1, '#3f5a66');
      break;
    case 'axe':
      line(c, 4, 14, 11, 3, 1.6, handle);
      poly(c, [9, 2, 14, 2, 14, 8, 10, 6], '#a8adb2');
      px(c, 13, 3, '#e0e4e8', 1, 4);
      break;
    case 'pick':
      line(c, 4, 14, 10, 4, 1.6, handle);
      line(c, 4, 4, 15, 6, 1.8, '#8a8f94');
      px(c, 5, 4, '#c8ccd0', 3, 1);
      break;
    case 'machete':
      line(c, 3, 14, 5, 12, 2, '#2e2620');
      poly(c, [5, 11, 13, 2, 15, 3, 7, 12], '#b8bdc2');
      line(c, 6, 11, 14, 3, 1, '#e8ecf0');
      break;
    case 'pistol':
      poly(c, [2, 5, 13, 5, 13, 8, 2, 8], '#3a3c3e');
      poly(c, [3, 8, 7, 8, 6, 14, 3, 14], '#4a3a2c');
      px(c, 2, 5, '#6a6c6e', 11, 1);
      break;
  }
  return cv;
}

function material(id: string): Cv {
  const cv = base();
  const c = cv.ctx;
  switch (id) {
    case 'wood':
      for (let i = 0; i < 3; i++) {
        const y = 5 + i * 3;
        poly(c, [2, y, 14, y - 2, 14, y + 1, 2, y + 3], i % 2 ? '#7a5a3a' : '#8a6a44');
        ellipse(c, 14, y - 0.5, 1.4, 1.5, '#c8a878');
      }
      break;
    case 'stone':
      ellipse(c, 6, 10, 4, 3, '#7a756c');
      ellipse(c, 11, 9, 3.5, 3, '#8d887f');
      px(c, 9, 7, '#aaa59c', 2, 1);
      break;
    case 'scrap':
      poly(c, [2, 9, 9, 4, 13, 7, 6, 13], '#8a4a28');
      poly(c, [7, 12, 14, 10, 14, 14, 8, 15], '#7a7e82');
      px(c, 6, 7, '#b06c3c', 2, 1);
      break;
    case 'fibre':
      for (let i = 0; i < 6; i++) line(c, 3 + i * 1.8, 14, 5 + i * 1.2, 2, 1, i % 2 ? '#8f9b74' : '#6b7a5a');
      line(c, 3, 10, 13, 10, 1, '#c8b080');
      break;
    case 'cloth':
      poly(c, [2, 4, 13, 3, 14, 13, 3, 14], '#a89878');
      line(c, 3, 7, 13, 6, 1, '#8a7a5a');
      line(c, 3, 10, 13, 9, 1, '#8a7a5a');
      break;
    case 'compost':
      ellipse(c, 8, 10, 6, 4, '#3a2a1e');
      px(c, 5, 8, '#5a7a30', 2, 1);
      px(c, 10, 9, '#6a4a2a', 2, 1);
      break;
  }
  return cv;
}

function misc(id: string): Cv {
  const cv = base();
  const c = cv.ctx;
  switch (id) {
    case 'tinned_beans':
      poly(c, [4, 4, 12, 4, 12, 14, 4, 14], '#8a8f94');
      poly(c, [4, 7, 12, 7, 12, 11, 4, 11], '#b84a2a');
      ellipse(c, 8, 4, 4, 1.5, '#b8bdc2');
      break;
    case 'flatbread':
      ellipse(c, 8, 9, 6.5, 4.5, '#c8a870');
      px(c, 5, 8, '#8a6a40');
      px(c, 9, 10, '#8a6a40');
      px(c, 11, 8, '#8a6a40');
      break;
    case 'bandage':
      ellipse(c, 8, 8, 5, 5, '#e8e0d0');
      ellipse(c, 8, 8, 2, 2, '#c8c0b0');
      line(c, 12, 10, 15, 14, 2, '#e8e0d0');
      break;
    case 'iodide_tabs':
      poly(c, [5, 3, 11, 3, 11, 14, 5, 14], '#e8e4d8');
      poly(c, [5, 3, 11, 3, 11, 5, 5, 5], '#4a6a8a');
      px(c, 7, 8, '#4a6a8a', 2, 3);
      break;
    case 'rounds':
      for (let i = 0; i < 3; i++) {
        poly(c, [3 + i * 4, 6, 6 + i * 4, 6, 6 + i * 4, 14, 3 + i * 4, 14], '#c8a050');
        ellipse(c, 4.5 + i * 4, 6, 1.5, 2, '#8a6a4a');
      }
      break;
  }
  return cv;
}

function placeable(id: string): Cv {
  const cv = base();
  const c = cv.ctx;
  const wood = '#7a6248';
  switch (id) {
    case 'fence':
      for (const x of [3, 12]) poly(c, [x, 3, x + 2, 3, x + 2, 15, x, 15], wood);
      line(c, 2, 7, 15, 7, 1.5, '#8a7258');
      line(c, 2, 11, 15, 11, 1.5, '#8a7258');
      break;
    case 'gate':
      poly(c, [2, 4, 14, 4, 14, 14, 2, 14], '#8a6a4a');
      for (let x = 4; x < 14; x += 3) line(c, x, 4, x, 14, 1, '#6a4a32');
      line(c, 2, 13, 14, 5, 1.5, '#5a3a28');
      break;
    case 'lamp':
      line(c, 7, 4, 7, 15, 1.6, '#3b3e42');
      line(c, 7, 4, 11, 4, 1.4, '#3b3e42');
      poly(c, [10, 5, 13, 5, 13, 9, 10, 9], '#ffe7a0');
      break;
    case 'compost_bin':
      poly(c, [3, 5, 13, 5, 13, 14, 3, 14], wood);
      for (let y = 7; y < 14; y += 2) line(c, 3, y, 13, y, 1, '#4a3a2c');
      break;
    case 'bunk':
      poly(c, [2, 8, 14, 8, 14, 11, 2, 11], '#8a3a2c');
      poly(c, [2, 8, 5, 8, 5, 10, 2, 10], '#d8d0b8');
      line(c, 2, 11, 2, 14, 1, wood);
      line(c, 14, 11, 14, 14, 1, wood);
      poly(c, [1, 4, 15, 4, 12, 7, 4, 7], '#8a8060');
      break;
    case 'rain_barrel':
      ellipse(c, 8, 4, 4.5, 1.8, '#3a6a80');
      poly(c, [3.5, 4, 12.5, 4, 12.5, 14, 3.5, 14], '#4f6670');
      line(c, 3.5, 7, 12.5, 7, 1, '#3b4a52');
      line(c, 3.5, 11, 12.5, 11, 1, '#3b4a52');
      break;
    case 'spike_trap':
      poly(c, [2, 11, 14, 11, 14, 14, 2, 14], '#4a3a2c');
      for (let x = 3; x < 14; x += 2.5) line(c, x, 11, x, 5, 1, '#c8ccd0');
      break;
    case 'sprinkler':
      line(c, 8, 7, 8, 14, 2, '#6f7376');
      poly(c, [4, 5, 12, 5, 12, 7, 4, 7], '#c8a050');
      px(c, 3, 3, '#8ac0d8');
      px(c, 12, 2, '#8ac0d8');
      px(c, 8, 1, '#8ac0d8');
      break;
  }
  return cv;
}

const cache = new Map<string, string>();
const canvasCache = new Map<string, HTMLCanvasElement>();

/** A data URL for the item's icon, drawn once and cached. Tainted produce gets a sickly cast. */
export function iconURL(id: string, tainted = false): string {
  const key = id + (tainted ? ':t' : '');
  const hit = cache.get(key);
  if (hit) return hit;
  const url = iconCanvas(id, tainted).toDataURL();
  cache.set(key, url);
  return url;
}

/** The icon as a 16 by 16 canvas. */
export function iconCanvas(id: string, tainted = false): HTMLCanvasElement {
  const key = id + (tainted ? ':t' : '');
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const it = ITEMS[id];
  let cv: Cv;
  if (!it) cv = base();
  else if (it.kind === 'seed') cv = seedPacket(CROPS[it.crop!].fruit);
  else if (it.kind === 'produce') cv = produce(id);
  else if (it.kind === 'tool' || it.kind === 'weapon') cv = tool(id);
  else if (it.kind === 'material') cv = material(id);
  else if (it.kind === 'place') cv = placeable(id);
  else cv = misc(id);
  crisp(cv);
  outline(cv, '#1a1410');
  if (tainted) {
    const ctx = cv.ctx;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(120,130,40,0.35)';
    ctx.fillRect(0, 0, 16, 16);
    ctx.globalCompositeOperation = 'source-over';
  }
  canvasCache.set(key, cv.canvas);
  return cv.canvas;
}
