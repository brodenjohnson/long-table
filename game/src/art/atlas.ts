// Packs many small canvases into a few large atlas textures, so the renderer can batch them.
import { Rectangle, Texture } from 'pixi.js';
import { Cv, makeCanvas } from './pixel';

interface Pending {
  name: string;
  cv: Cv;
  ax: number;
  ay: number;
}

const SIZE = 2048;
const PAD = 1;

export class Atlas {
  private pending: Pending[] = [];
  readonly textures = new Map<string, Texture>();
  readonly canvases: HTMLCanvasElement[] = [];

  /** Queue a canvas. Anchor (ax, ay) is in pixels from the top-left, e.g. a character's feet. */
  add(name: string, cv: Cv, ax = cv.w / 2, ay = cv.h): void {
    this.pending.push({ name, cv, ax, ay });
  }

  has(name: string): boolean {
    return this.textures.has(name) || this.pending.some(p => p.name === name);
  }

  /** Pack everything queued so far into atlas pages and create textures. */
  build(): void {
    const items = this.pending.sort((a, b) => b.cv.h - a.cv.h);
    this.pending = [];
    let page = makeCanvas(SIZE, SIZE);
    let pageItems: { p: Pending; x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    const flush = () => {
      if (!pageItems.length) return;
      this.canvases.push(page.canvas);
      const base = Texture.from(page.canvas);
      base.source.scaleMode = 'nearest';
      for (const it of pageItems) {
        const t = new Texture({
          source: base.source,
          frame: new Rectangle(it.x, it.y, it.p.cv.w, it.p.cv.h),
          defaultAnchor: { x: it.p.ax / it.p.cv.w, y: it.p.ay / it.p.cv.h }
        });
        this.textures.set(it.p.name, t);
      }
    };
    for (const p of items) {
      if (x + p.cv.w + PAD > SIZE) {
        x = 0;
        y += rowH + PAD;
        rowH = 0;
      }
      if (y + p.cv.h + PAD > SIZE) {
        flush();
        page = makeCanvas(SIZE, SIZE);
        pageItems = [];
        x = 0;
        y = 0;
        rowH = 0;
      }
      page.ctx.drawImage(p.cv.canvas, x, y);
      pageItems.push({ p, x, y });
      x += p.cv.w + PAD;
      rowH = Math.max(rowH, p.cv.h);
    }
    flush();
  }

  get(name: string): Texture {
    const t = this.textures.get(name);
    if (!t) throw new Error(`No texture called ${name}`);
    return t;
  }

  tryGet(name: string): Texture | undefined {
    return this.textures.get(name);
  }
}
