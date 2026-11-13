// Low-level helpers for drawing pixel art in code: canvases, colours, hard edges and outlines.

export interface Cv {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export function makeCanvas(w: number, h: number): Cv {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx, w: canvas.width, h: canvas.height };
}

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  const s = c.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(ch => ch + ch).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(c: RGB): string {
  return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function mix(a: string, b: string, t: number): string {
  const A = hex(a);
  const B = hex(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** Lighten (amt > 0) or darken (amt < 0) with a slight hue shift: shadows go cooler, lights go warmer. */
export function shade(c: string, amt: number): string {
  const [r, g, b] = hex(c);
  if (amt >= 0) {
    return toHex([r + (255 - r) * amt * 1.0, g + (245 - g) * amt * 0.95, b + (215 - b) * amt * 0.85]);
  }
  const k = 1 + amt;
  return toHex([r * k * 0.96, g * k * 0.98, b * k + (1 - k) * 18]);
}

export function rgba(c: string, a: number): string {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}

/** Make every pixel fully opaque or fully transparent, so anti-aliased shapes become crisp pixel shapes. */
export function crisp(cv: Cv, threshold = 110): void {
  const img = cv.ctx.getImageData(0, 0, cv.w, cv.h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= threshold ? 255 : 0;
  cv.ctx.putImageData(img, 0, 0);
}

/**
 * Add a one-pixel outline around the silhouette. The outline takes a darkened version of the
 * neighbouring colour ("selective outline") unless a fixed colour is given.
 */
export function outline(cv: Cv, fixed?: string, darken = 0.62): void {
  const img = cv.ctx.getImageData(0, 0, cv.w, cv.h);
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  const W = cv.w;
  const H = cv.h;
  const F = fixed ? hex(fixed) : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] !== 0) continue;
      let n = -1;
      if (x > 0 && d[i - 4 + 3]) n = i - 4;
      else if (x < W - 1 && d[i + 4 + 3]) n = i + 4;
      else if (y > 0 && d[i - W * 4 + 3]) n = i - W * 4;
      else if (y < H - 1 && d[i + W * 4 + 3]) n = i + W * 4;
      if (n < 0) continue;
      if (F) {
        out[i] = F[0];
        out[i + 1] = F[1];
        out[i + 2] = F[2];
      } else {
        out[i] = d[n] * (1 - darken) * 0.9;
        out[i + 1] = d[n + 1] * (1 - darken) * 0.85;
        out[i + 2] = d[n + 2] * (1 - darken) * 0.95 + 8;
      }
      out[i + 3] = 255;
    }
  }
  img.data.set(out);
  cv.ctx.putImageData(img, 0, 0);
}

/** Darken pixels along the bottom-right edges of the silhouette, a cheap form of form shading. */
export function rimShade(cv: Cv, amt = 0.25): void {
  const img = cv.ctx.getImageData(0, 0, cv.w, cv.h);
  const d = img.data;
  const W = cv.w;
  const H = cv.h;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      if (!src[i + 3]) continue;
      const below = src[i + W * 4 + 3];
      const right = src[i + 4 + 3];
      if (!below || !right) {
        d[i] *= 1 - amt;
        d[i + 1] *= 1 - amt;
        d[i + 2] = d[i + 2] * (1 - amt) + 6;
      }
    }
  }
  cv.ctx.putImageData(img, 0, 0);
}

/** Speckle existing opaque pixels with light and dark noise for texture. */
export function speckle(cv: Cv, rng: () => number, amount = 0.12, density = 0.25): void {
  const img = cv.ctx.getImageData(0, 0, cv.w, cv.h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || rng() > density) continue;
    const k = 1 + (rng() * 2 - 1) * amount;
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
  cv.ctx.putImageData(img, 0, 0);
}

/** Fill a polygon given as flat [x0,y0,x1,y1,...] in native pixels. */
export function poly(ctx: CanvasRenderingContext2D, pts: number[], fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

export function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, c: string): void {
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Copy a canvas flipped horizontally. */
export function flipH(src: Cv): Cv {
  const c = makeCanvas(src.w, src.h);
  c.ctx.translate(src.w, 0);
  c.ctx.scale(-1, 1);
  c.ctx.drawImage(src.canvas, 0, 0);
  return c;
}

/** Iso diamond for one tile, top vertex at (x, y). */
export function diamond(x: number, y: number, w = 32, h = 16): number[] {
  return [x, y, x + w / 2, y + h / 2, x, y + h, x - w / 2, y + h / 2];
}
