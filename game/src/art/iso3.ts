// A tiny isometric 3D painter for drawing buildings, props and vehicles into a canvas.
// x and y are tile units on the ground, z is height in native pixels.
import { Cv, makeCanvas, poly, shade } from './pixel';

export interface Faces {
  top: string;
  left: string; // the +y face, toward the lower left of the screen (lit)
  right: string; // the +x face, toward the lower right of the screen (shadowed)
}

export function faces(base: string, topLift = 0.18, rightDrop = -0.28): Faces {
  return { top: shade(base, topLift), left: base, right: shade(base, rightDrop) };
}

export class Iso3 {
  readonly cv: Cv;
  /** Canvas position of tile-space (0,0,0). */
  readonly ox: number;
  readonly oy: number;

  /**
   * A canvas for a footprint of w by h tiles, with `up` pixels of headroom above the top vertex
   * and `pad` pixels of margin on each side and below.
   */
  constructor(w: number, h: number, up: number, pad = 2) {
    const cw = (w + h) * 16 + pad * 2;
    const ch = (w + h) * 8 + up + pad;
    this.cv = makeCanvas(cw, ch);
    this.ox = h * 16 + pad;
    this.oy = up;
  }

  get ctx(): CanvasRenderingContext2D {
    return this.cv.ctx;
  }

  p(x: number, y: number, z = 0): [number, number] {
    return [this.ox + (x - y) * 16, this.oy + (x + y) * 8 - z];
  }

  /** Anchor in canvas pixels for a point on the ground, usually the footprint centre. */
  anchor(x: number, y: number): [number, number] {
    return this.p(x, y, 0);
  }

  quad(pts: [number, number, number][], fill: string): void {
    const flat: number[] = [];
    for (const [x, y, z] of pts) flat.push(...this.p(x, y, z));
    poly(this.ctx, flat, fill);
  }

  /** An axis-aligned box. Draws the three visible faces. */
  box(x: number, y: number, z: number, w: number, d: number, h: number, f: Faces): void {
    this.quad([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], f.left);
    this.quad([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], f.right);
    this.quad([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], f.top);
  }

  /** Lines across the +y face (horizontal planks or courses). */
  leftLines(x: number, y: number, z: number, w: number, h: number, gap: number, c: string): void {
    for (let k = gap; k < h; k += gap) this.seg([x, y, z + k], [x + w, y, z + k], c);
  }

  rightLines(x: number, y: number, z: number, d: number, h: number, gap: number, c: string): void {
    for (let k = gap; k < h; k += gap) this.seg([x, y, z + k], [x, y + d, z + k], c);
  }

  seg(a: [number, number, number], b: [number, number, number], c: string, width = 1): void {
    const [x0, y0] = this.p(...a);
    const [x1, y1] = this.p(...b);
    const ctx = this.ctx;
    ctx.fillStyle = c;
    // Bresenham, for crisp single-pixel lines
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 2000; guard++) {
      ctx.fillRect(ax, ay, width, width);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  /** A gable roof over a box, ridge running along x. */
  gableX(x: number, y: number, z: number, w: number, d: number, rise: number, roof: string, gable: string, overhang = 0.15): void {
    const o = overhang;
    const ym = y + d / 2;
    // far slope (toward -y) is mostly hidden; draw it first
    this.quad([[x - o, y - o, z], [x + w + o, y - o, z], [x + w + o, ym, z + rise], [x - o, ym, z + rise]], shade(roof, 0.12));
    // gable end on the +x side
    this.quad([[x + w, y, z], [x + w, y + d, z], [x + w, ym, z + rise]], gable);
    // near slope (toward +y)
    this.quad([[x - o, ym, z + rise], [x + w + o, ym, z + rise], [x + w + o, y + d + o, z], [x - o, y + d + o, z]], roof);
  }

  /** A gable roof with the ridge along y. */
  gableY(x: number, y: number, z: number, w: number, d: number, rise: number, roof: string, gable: string, overhang = 0.15): void {
    const o = overhang;
    const xm = x + w / 2;
    this.quad([[x - o, y - o, z], [x - o, y + d + o, z], [xm, y + d + o, z + rise], [xm, y - o, z + rise]], shade(roof, 0.12));
    this.quad([[x, y + d, z], [x + w, y + d, z], [xm, y + d, z + rise]], gable);
    this.quad([[xm, y - o, z + rise], [xm, y + d + o, z + rise], [x + w + o, y + d + o, z], [x + w + o, y - o, z]], shade(roof, -0.22));
  }
}

/** A vertical-ish cylinder, drawn as an ellipse top over a band. Centre (cx, cy) in canvas pixels at its base. */
export function cylinder(cv: Cv, cx: number, cy: number, r: number, h: number, side: string, top: string): void {
  const ctx = cv.ctx;
  const ry = r / 2;
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - r, cy - h);
  ctx.ellipse(cx, cy - h, r, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  // darker right half
  ctx.fillStyle = shade(side, -0.25);
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.25, cy + ry * 0.97);
  ctx.ellipse(cx, cy, r, ry, 0, Math.PI * 0.42, 0, true);
  ctx.lineTo(cx + r, cy - h);
  ctx.lineTo(cx + r * 0.25, cy - h + ry);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, r, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function blankIso(w: number, h: number, up: number): Iso3 {
  return new Iso3(w, h, up);
}

export { makeCanvas };
