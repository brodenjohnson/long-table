// A* on the tile grid, for hired hands. Small map, so a plain binary heap is plenty.
import { MAP_W } from '../core/config';
import { World, idx, inMap } from './world';

export function findPath(world: World, sx: number, sy: number, tx: number, ty: number, friendly = true, maxNodes = 6000): { x: number; y: number }[] | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  if (!inMap(tx, ty)) return null;
  const start = idx(sx, sy);
  const goal = idx(tx, ty);
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const open: [number, number][] = [];
  const push = (k: number, f: number) => {
    open.push([f, k]);
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (open[p][0] <= open[i][0]) break;
      [open[p], open[i]] = [open[i], open[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = open[0][1];
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < open.length && open[l][0] < open[m][0]) m = l;
        if (r < open.length && open[r][0] < open[m][0]) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i], open[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (k: number) => {
    const x = k % MAP_W;
    const y = Math.floor(k / MAP_W);
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };
  g.set(start, 0);
  push(start, h(start));
  let seen = 0;
  // The goal itself may be blocked (a crop under a hand's feet is fine, an object is not): allow ending next to it
  const goalBlocked = !world.walkable(tx, ty, friendly);
  while (open.length && seen++ < maxNodes) {
    const k = pop();
    const x = k % MAP_W;
    const y = Math.floor(k / MAP_W);
    const near = goalBlocked && Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1;
    if (k === goal || near) {
      const out: { x: number; y: number }[] = [];
      let c = k;
      while (c !== start) {
        out.push({ x: (c % MAP_W) + 0.5, y: Math.floor(c / MAP_W) + 0.5 });
        c = came.get(c)!;
      }
      return out.reverse();
    }
    const gk = g.get(k)!;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!world.walkable(nx, ny, friendly)) continue;
        if (dx && dy && (!world.walkable(x + dx, y, friendly) || !world.walkable(x, y + dy, friendly))) continue;
        const nk = idx(nx, ny);
        const cost = gk + (dx && dy ? 1.41 : 1);
        if (cost < (g.get(nk) ?? Infinity)) {
          g.set(nk, cost);
          came.set(nk, k);
          push(nk, cost + h(nk));
        }
      }
  }
  return null;
}
