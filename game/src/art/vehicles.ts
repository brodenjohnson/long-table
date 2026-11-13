// The Hull Provisioning truck, drawn as boxes in four directions.
import { Atlas } from './atlas';
import { Iso3, faces } from './iso3';
import { crisp, ellipse, outline, px, shade } from './pixel';

const PAINT = '#2f5a5a';
const STRIPE = '#d8742a';

/** dir: 0 = +x (screen down-right), 1 = +y (down-left), 2 = -x (up-left), 3 = -y (up-right). */
function truck(dir: number) {
  const alongX = dir === 0 || dir === 2;
  const fw = alongX ? 2 : 1;
  const fh = alongX ? 1 : 2;
  const iso = new Iso3(fw, fh, 34, 3);
  const ctx = iso.ctx;
  // Helper: box in the truck's own frame (a along its length 0..2, b across 0..1)
  const forward = dir === 0 || dir === 1;
  const B = (a: number, b: number, z: number, la: number, lb: number, h: number, base: string) => {
    let a0 = forward ? a : 2 - a - la;
    if (alongX) iso.box(a0, b, z, la, lb, h, faces(base, 0.15, -0.3));
    else iso.box(b, a0, z, lb, la, h, faces(base, 0.15, -0.3));
  };
  const seg = (a: number, b: number, z: number, a2: number, b2: number, z2: number, c: string) => {
    const A = forward ? a : 2 - a;
    const A2 = forward ? a2 : 2 - a2;
    if (alongX) iso.seg([A, b, z], [A2, b2, z2], c);
    else iso.seg([b, A, z], [b2, A2, z2], c);
  };
  // Chassis
  B(0.05, 0.12, 3, 1.9, 0.76, 3, '#2a2826');
  // Flatbed with sides
  B(0.08, 0.1, 6, 1.2, 0.8, 2, shade(PAINT, -0.1));
  // Cargo: crates under a tarp
  B(0.15, 0.18, 8, 0.5, 0.6, 7, '#8a6a44');
  B(0.68, 0.2, 8, 0.45, 0.55, 5, '#7a5a3a');
  B(0.14, 0.16, 15, 0.52, 0.64, 1, '#6f6a50');
  // Cab
  B(1.3, 0.12, 6, 0.62, 0.76, 9, PAINT);
  B(1.33, 0.15, 15, 0.45, 0.7, 5, shade(PAINT, 0.08));
  // Windscreen and side window
  seg(1.79, 0.2, 16, 1.79, 0.82, 16, '#1a2226');
  seg(1.79, 0.2, 18.5, 1.79, 0.82, 18.5, '#26343a');
  // Stripe along the side
  seg(0.1, 0.9, 7, 1.9, 0.9, 7, STRIPE);
  seg(0.1, 0.9, 8, 1.9, 0.9, 8, STRIPE);
  // Bull bar
  B(1.92, 0.12, 3, 0.06, 0.76, 6, '#55595d');
  crisp(iso.cv);
  // Wheels on the visible side (the +y side when moving along x, the +x side when moving along y)
  const wheelAt = (a: number) => {
    const A = forward ? a : 2 - a;
    const [x, y] = alongX ? iso.p(A, 0.9, 2.5) : iso.p(0.9, A, 2.5);
    ellipse(ctx, x, y, 3.2, 3.2, '#141414');
    ellipse(ctx, x, y, 1.4, 1.4, '#5f6366');
  };
  wheelAt(0.4);
  wheelAt(1.6);
  // Headlight
  {
    const A = forward ? 1.97 : 0.03;
    const [x, y] = alongX ? iso.p(A, 0.8, 8) : iso.p(0.8, A, 8);
    px(ctx, x - 1, y - 1, '#f8e8a8', 2, 2);
  }
  crisp(iso.cv);
  outline(iso.cv);
  const [ax, ay] = iso.anchor(fw / 2, fh / 2);
  return { cv: iso.cv, ax, ay };
}

export function paintVehicles(atlas: Atlas): void {
  for (let d = 0; d < 4; d++) {
    const t = truck(d);
    atlas.add(`truck:${d}`, t.cv, t.ax, t.ay);
  }
}
