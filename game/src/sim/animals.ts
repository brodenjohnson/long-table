// Hens: they forage near their coop by day, shut themselves in at dusk, and lay if they ate.
import { STEP } from '../core/config';
import { dirFromScreen, tileToScreenVec } from '../core/iso';
import { HenState } from './state';
import { T, idx, inMap } from './world';
import type { Sim } from './sim';

const NAMES = ['Dot', 'Marge', 'Pickle', 'Sergeant', 'Toast', 'Biscuit', 'Ruby', 'Clover', 'Ash', 'Nettle', 'Button', 'Gravel', 'Duchess', 'Patch'];
const PER_COOP = 4;
const SPEED = 0.9;

interface HenRt {
  gx: number;
  gy: number;
  t: number;
  peck: number;
  anim: 'idle' | 'walk' | 'peck';
  animT: number;
}

export class AnimalSystem {
  private rt = new Map<number, HenRt>();

  constructor(private sim: Sim) {}

  runtime(h: HenState): HenRt {
    let r = this.rt.get(h.id);
    if (!r) {
      r = { gx: h.x, gy: h.y, t: 0, peck: 0, anim: 'idle', animT: Math.random() };
      this.rt.set(h.id, r);
    }
    return r;
  }

  coopRoom(coopId: number): number {
    return PER_COOP - this.sim.state.hens.filter(h => h.coop === coopId).length;
  }

  /** The nearest coop with room, if any. */
  coopFor(x: number, y: number): number {
    let best = 0;
    let bd = Infinity;
    for (const o of this.sim.world.objects.values()) {
      if (o.kind !== 'coop' || this.coopRoom(o.id) <= 0) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < bd) {
        bd = d;
        best = o.id;
      }
    }
    return best;
  }

  /** Let a hen out of your bag. */
  release(x: number, y: number): boolean {
    const s = this.sim;
    const coop = this.coopFor(x, y);
    if (!coop) {
      s.toast('She needs a coop with room in it first. Make one: wood and a little scrap.', 'info');
      return false;
    }
    const name = NAMES[(s.state.nextHen - 1) % NAMES.length];
    const h: HenState = { id: s.state.nextHen++, name, x, y, dir: 2, coop, fed: false, mood: 60 };
    s.state.hens.push(h);
    s.sfx('hen', x, y);
    s.toast(`${name} shakes herself off and starts scratching at the dirt.`, 'good');
    return true;
  }

  /** Indoors from dusk until morning. */
  indoors(): boolean {
    const m = this.sim.state.minute % (24 * 60);
    return m >= 19 * 60 || m < 6 * 60 + 40;
  }

  update(): void {
    const s = this.sim;
    if (this.indoors()) return;
    for (const h of [...s.state.hens]) {
      const coop = s.world.objects.get(h.coop);
      if (!coop) {
        // Coop gone: find another, or wander
        h.coop = this.coopFor(h.x, h.y);
      }
      this.wander(h, this.runtime(h), coop ? coop.x + 0.5 : h.x, coop ? coop.y + 1.5 : h.y);
    }
  }

  private wander(h: HenState, r: HenRt, cx: number, cy: number): void {
    const s = this.sim;
    r.animT += STEP;
    r.t -= STEP;
    if (r.anim === 'peck') {
      if (r.t <= 0) {
        r.anim = 'idle';
        r.t = 0.5 + s.rng() * 1.5;
      }
      return;
    }
    const dx = r.gx - h.x;
    const dy = r.gy - h.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.15 || r.t <= 0) {
      if (s.rng() < 0.5) {
        r.anim = 'peck';
        r.t = 0.6 + s.rng() * 1.2;
        r.animT = 0;
        if (s.rng() < 0.15) s.sfx('hen', h.x, h.y, 0.35);
        return;
      }
      // New spot within six tiles of the coop
      for (let tries = 0; tries < 6; tries++) {
        const a = s.rng() * Math.PI * 2;
        const rr = 1 + s.rng() * 5;
        const gx = cx + Math.cos(a) * rr;
        const gy = cy + Math.sin(a) * rr;
        if (s.world.walkable(Math.floor(gx), Math.floor(gy), true) && !s.world.isWater(Math.floor(gx), Math.floor(gy))) {
          r.gx = gx;
          r.gy = gy;
          break;
        }
      }
      r.t = 3 + s.rng() * 3;
      return;
    }
    const sp = SPEED * STEP * (0.6 + 0.4 * Math.abs(Math.sin(r.animT * 9)));
    const nx = h.x + (dx / d) * sp;
    const ny = h.y + (dy / d) * sp;
    if (s.world.walkable(Math.floor(nx), Math.floor(ny), true)) {
      h.x = nx;
      h.y = ny;
    } else r.t = 0;
    const v = tileToScreenVec(dx, dy);
    h.dir = dirFromScreen(v.x, v.y);
    r.anim = 'walk';
  }

  /** Overnight: who ate, who lays, and whether anything got into the coop. */
  endDay(husksReached: number): string[] {
    const s = this.sim;
    const st = s.state;
    const w = s.world;
    const lines: string[] = [];
    let eggs = 0;
    for (const h of [...st.hens]) {
      const coop = w.objects.get(h.coop);
      if (!coop) continue;
      // Forage: enough open ground around the coop, outside the Cold season, or fibre in the coop
      let ground = 0;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const x = coop.x + dx;
          const y = coop.y + dy;
          if (!inMap(x, y)) continue;
          const t = w.terrain[idx(x, y)];
          if ((t === T.Grass || t === T.Dry || t === T.Dirt) && !w.objAt[idx(x, y)]) ground++;
        }
      const cold = s.season === 'Cold';
      const feed = Number(coop.s?.feed ?? 0);
      if (feed > 0) {
        coop.s = { ...(coop.s ?? {}), feed: feed - 1 };
        h.fed = true;
      } else h.fed = !cold && ground >= 30;
      h.mood = Math.max(0, Math.min(100, h.mood + (h.fed ? 6 : -12)));
      if (h.fed && s.rng() < 0.55 + h.mood / 250) {
        coop.s = { ...(coop.s ?? {}), eggs: Number(coop.s?.eggs ?? 0) + 1 };
        eggs++;
      }
    }
    if (eggs) lines.push(`${eggs} ${eggs === 1 ? 'egg' : 'eggs'} in the coop this morning.`);
    const hungry = st.hens.filter(h => !h.fed).length;
    if (hungry) lines.push(`${hungry === st.hens.length ? 'The hens are' : 'Some hens are'} hungry. Put fibre in the coop when the ground is bare or cold.`);
    // Husks that reached the farm may get into an unfenced coop
    for (let i = 0; i < husksReached && st.hens.length; i++) {
      if (s.rng() > 0.18) continue;
      const victim = st.hens[Math.floor(s.rng() * st.hens.length)];
      st.hens = st.hens.filter(h => h !== victim);
      this.rt.delete(victim.id);
      lines.push(`Something got into the coop in the night. ${victim.name} is gone.`);
    }
    // Everyone starts the morning by the coop door
    for (const h of st.hens) {
      const coop = w.objects.get(h.coop);
      if (coop) {
        h.x = coop.x + 0.5 + (s.rng() - 0.5) * 0.8;
        h.y = coop.y + 1.4 + s.rng() * 0.4;
      }
      const r = this.runtime(h);
      r.gx = h.x;
      r.gy = h.y;
    }
    return lines;
  }

  /** At the coop: collect eggs, or put in fibre as feed. */
  useCoop(coopId: number): void {
    const s = this.sim;
    const coop = s.world.objects.get(coopId);
    if (!coop) return;
    const eggs = Number(coop.s?.eggs ?? 0);
    if (eggs > 0) {
      s.drop({ id: 'egg', n: eggs }, coop.x + 0.5, coop.y + 0.8);
      coop.s = { ...(coop.s ?? {}), eggs: 0 };
      s.sfx('hen', coop.x, coop.y);
      return;
    }
    const sel = s.selected();
    if (sel && sel.id === 'fibre') {
      const k = Math.min(sel.n, 20);
      coop.s = { ...(coop.s ?? {}), feed: Number(coop.s?.feed ?? 0) + k };
      s.removeItemById('fibre', k);
      s.sfx('rustle', coop.x, coop.y);
      s.toast(`Put ${k} fibre in the coop as feed. Each hen eats one a day when she cannot forage.`, 'good');
      return;
    }
    const n = s.state.hens.filter(h => h.coop === coopId).length;
    const feed = Number(coop.s?.feed ?? 0);
    s.toast(n ? `${n} ${n === 1 ? 'hen lives' : 'hens live'} here. Feed in the coop: ${feed}. Hold fibre and use the coop to add more.` : 'An empty coop. Buy a hen from the Hull truck and let her out near it.', 'info');
  }

  view(h: HenState): { anim: 'idle' | 'walk' | 'peck'; animT: number } {
    const r = this.runtime(h);
    return { anim: r.anim, animT: r.animT };
  }
}
