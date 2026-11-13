// Hired hands: they turn up at the gate, work the field for a wage, and leave if they are treated badly.
import { STEP } from '../core/config';
import { dirFromScreen, tileToScreenVec } from '../core/iso';
import { HANDS, HandDef } from '../data';
import type { Anim, Tool } from '../art/rig';
import { findPath } from './path';
import { HandState } from './state';
import { idx } from './world';
import { PLACES } from './worldgen';
import type { Sim } from './sim';

interface HandRt {
  path: { x: number; y: number }[];
  task: null | { kind: 'harvest' | 'water' | 'refill' | 'deposit' | 'rest' | 'bed'; x: number; y: number; k?: number };
  timer: number;
  anim: Anim;
  animT: number;
  tool: Tool;
  repath: number;
  idleT: number;
  hp: number;
  wounded: boolean;
  attackCd: number;
}

const SPEED = 2.5;
const CAN = 12;

export class HandSystem {
  private rt = new Map<string, HandRt>();
  private reserved = new Set<number>();

  constructor(private sim: Sim) {}

  def(id: string): HandDef {
    return HANDS.find(h => h.id === id)!;
  }

  runtime(h: HandState): HandRt {
    let r = this.rt.get(h.id);
    if (!r) {
      r = { path: [], task: null, timer: 0, anim: 'idle', animT: 0, tool: 'none', repath: 0, idleT: 0, hp: 60, wounded: false, attackCd: 0 };
      this.rt.set(h.id, r);
    }
    return r;
  }

  applicantPos(): { x: number; y: number } | null {
    const s = this.sim;
    const a = s.state.applicant;
    if (!a) return null;
    const m = s.state.minute;
    if (m < 7 * 60 || m > 19 * 60) return null;
    return { x: PLACES.gate.x, y: PLACES.gate.y };
  }

  asleep(h: HandState): boolean {
    const m = this.sim.state.minute % (24 * 60);
    if (h.job === 'guard') return m >= 8 * 60 && m < 15 * 60 + 30;
    return m >= 21 * 60 + 30 || m < 6 * 60 + 30;
  }

  /** Guards awake and standing, for Husks to go after. */
  activeGuards(): HandState[] {
    return this.sim.state.hands.filter(h => h.job === 'guard' && !this.asleep(h) && !this.runtime(h).wounded);
  }

  hurt(h: HandState, dmg: number, fromX: number, fromY: number): void {
    const s = this.sim;
    const r = this.runtime(h);
    if (r.wounded) return;
    r.hp -= dmg;
    s.emit({ t: 'fx', kind: 'blood', x: h.x, y: h.y, z: 12, n: 6 });
    s.sfx('hurt', h.x, h.y, 0.7);
    void fromX;
    void fromY;
    if (r.hp <= 0) {
      r.wounded = true;
      r.anim = 'dead';
      h.morale -= 15;
      s.toast(`${this.def(h.id).name} is down.`, 'bad');
      s.notes.push(`${this.def(h.id).name} was hurt on watch.`);
    }
  }

  /** While you sleep: guards on duty account for some of the Husks still to come. */
  resolveGuards(pending: number): { kills: number; lines: string[] } {
    const s = this.sim;
    let kills = 0;
    const lines: string[] = [];
    for (const h of s.state.hands) {
      if (h.job !== 'guard' || this.runtime(h).wounded || pending - kills <= 0) continue;
      const d = this.def(h.id);
      const k = Math.min(pending - kills, Math.max(0, d.nerve - 1 + Math.floor(s.rng() * 2)));
      kills += k;
      if (k) {
        h.morale += 2;
        lines.push(`${d.name} put down ${k} ${k === 1 ? 'Husk' : 'Husks'} on watch.`);
      }
      if (s.rng() < 0.1 + 0.04 * (pending - kills)) {
        h.morale -= 12;
        lines.push(`${d.name} took a bad scratch holding the line.`);
      }
      if (d.nerve < 2) {
        h.morale -= 6;
        lines.push(`${d.name} did not sleep. Standing watch frightens them.`);
      }
    }
    return { kills, lines };
  }

  freeBunk(): number {
    const s = this.sim;
    const used = new Set(s.state.hands.map(h => h.bunk));
    for (const o of s.world.objects.values()) if (o.kind === 'bunk' && !used.has(o.id)) return o.id;
    return 0;
  }

  hire(id: string): void {
    const s = this.sim;
    const d = this.def(id);
    const h: HandState = { id, x: PLACES.gate.x, y: PLACES.gate.y, dir: 6, morale: 62, unpaid: 0, daysWorked: 0, bunk: this.freeBunk(), job: 'tend', water: CAN, carrying: [] };
    s.state.hands.push(h);
    s.state.applicant = null;
    s.state.journal.push({ day: s.state.day, text: `Took on ${d.name} for ${d.wage} scrip a day.` });
    s.toast(h.bunk ? `${d.name} starts now. They have a bunk.` : `${d.name} starts now. There is no bunk for them, and they will not like sleeping rough.`, h.bunk ? 'good' : 'info');
    s.sfx('hire');
  }

  turnAway(): void {
    const s = this.sim;
    if (!s.state.applicant) return;
    s.state.goneHands.push(s.state.applicant.id);
    s.state.applicant = null;
  }

  letGo(id: string): void {
    const s = this.sim;
    const h = s.state.hands.find(x => x.id === id);
    if (!h) return;
    s.state.hands = s.state.hands.filter(x => x.id !== id);
    s.state.goneHands.push(id);
    // What they were carrying goes in the crate
    for (const c of h.carrying) s.state.depot.push(c);
    this.rt.delete(id);
    s.state.journal.push({ day: s.state.day, text: `Let ${this.def(id).name} go.` });
    s.toast(`${this.def(id).name} packs up and walks toward the road.`, 'info');
  }

  /** Picks someone to turn up at the gate tomorrow, sometimes. */
  maybeApplicant(): void {
    const s = this.sim;
    if (s.state.applicant || s.state.day < 3) return;
    if (s.state.hands.length >= 4) return;
    const pool = HANDS.filter(h => !s.state.goneHands.includes(h.id) && !s.state.hands.some(x => x.id === h.id));
    if (!pool.length) return;
    const chance = s.state.day === 3 ? 1 : 0.35;
    if (s.rng() > chance) return;
    const pick = pool[Math.floor(s.rng() * pool.length)];
    s.state.applicant = { id: pick.id, day: s.state.day };
    s.notes.push('Someone is waiting at the gate by the road, looking for work.');
  }

  /** End of day: wages, beds, morale, and whether anyone leaves. */
  endDay(): string[] {
    const s = this.sim;
    const lines: string[] = [];
    for (const h of [...s.state.hands]) {
      const d = this.def(h.id);
      h.daysWorked++;
      if (s.state.player.scrip >= d.wage) {
        s.state.player.scrip -= d.wage;
        h.unpaid = 0;
        h.morale += 3;
        lines.push(`Paid ${d.name} ${d.wage} scrip.`);
      } else {
        h.unpaid++;
        h.morale -= 18;
        lines.push(`Could not pay ${d.name}. They noticed.`);
      }
      // A bunk of their own
      if (!h.bunk || !s.world.objects.get(h.bunk)) {
        h.bunk = this.freeBunk();
        if (!h.bunk) {
          h.morale -= 8;
          lines.push(`${d.name} slept rough again.`);
        }
      } else h.morale += 2;
      // Nights with Husks in the field wear on people with no nerve
      if (Number(s.state.flags.trampled ?? 0) > 0 && d.nerve < 2) h.morale -= 4;
      h.morale = Math.max(0, Math.min(100, h.morale));
      if (h.morale < 12 || h.unpaid >= 3) {
        // They go in the night, and they take something with them
        let took = '';
        const stash = s.state.depot.sort((a, b) => b.n - a.n)[0];
        if (stash) {
          const k = Math.ceil(stash.n / 2);
          stash.n -= k;
          took = ` They took ${k} from the depot crate.`;
          if (stash.n <= 0) s.state.depot.splice(s.state.depot.indexOf(stash), 1);
        }
        s.state.hands = s.state.hands.filter(x => x !== h);
        s.state.goneHands.push(h.id);
        lines.push(`${d.name} left in the night.${took}`);
        s.state.journal.push({ day: s.state.day, text: `${d.name} walked out.${took}` });
      }
    }
    // Everyone starts the day at their bunk
    for (const h of s.state.hands) {
      const b = s.world.objects.get(h.bunk);
      h.x = b ? b.x + 0.5 : PLACES.bed.x;
      h.y = b ? b.y + 1.4 : PLACES.bed.y + 1;
      h.water = CAN;
      const r = this.runtime(h);
      r.path = [];
      r.task = null;
      r.hp = 60;
      r.wounded = false;
    }
    return lines;
  }

  update(): void {
    const s = this.sim;
    this.reserved.clear();
    for (const h of s.state.hands) {
      const r = this.runtime(h);
      if (r.task?.k !== undefined) this.reserved.add(r.task.k);
    }
    for (const h of s.state.hands) this.updateHand(h, this.runtime(h));
  }

  private face(h: HandState, x: number, y: number): void {
    const v = tileToScreenVec(x - h.x, y - h.y);
    if (Math.abs(v.x) + Math.abs(v.y) > 0.01) h.dir = dirFromScreen(v.x, v.y);
  }

  private walk(h: HandState, r: HandRt): boolean {
    if (!r.path.length) return true;
    const n = r.path[0];
    const dx = n.x - h.x;
    const dy = n.y - h.y;
    const d = Math.hypot(dx, dy);
    const sp = SPEED * (h.morale < 30 ? 0.7 : 1) * STEP;
    if (d <= sp) {
      h.x = n.x;
      h.y = n.y;
      r.path.shift();
    } else {
      h.x += (dx / d) * sp;
      h.y += (dy / d) * sp;
    }
    this.face(h, n.x, n.y);
    if (r.anim !== 'walk') {
      r.anim = 'walk';
      r.animT = 0;
    }
    r.tool = 'none';
    return r.path.length === 0;
  }

  private goTo(h: HandState, r: HandRt, x: number, y: number): boolean {
    const p = findPath(this.sim.world, h.x, h.y, x, y, true);
    if (!p) return false;
    r.path = p;
    return true;
  }

  private nearestCrop(h: HandState, want: (k: number) => boolean): { x: number; y: number; k: number } | null {
    const w = this.sim.world;
    let best: { x: number; y: number; k: number } | null = null;
    let bd = Infinity;
    for (const [k, c] of w.crops) {
      if (c.dead || this.reserved.has(k) || !want(k)) continue;
      const x = k % 96;
      const y = Math.floor(k / 96);
      const d = Math.abs(x + 0.5 - h.x) + Math.abs(y + 0.5 - h.y);
      if (d < bd) {
        bd = d;
        best = { x, y, k };
      }
    }
    return best;
  }

  private updateHand(h: HandState, r: HandRt): void {
    const s = this.sim;
    const w = s.world;
    const d = this.def(h.id);
    r.animT += STEP;
    const m = s.state.minute % (24 * 60);

    // Sleep
    if (this.asleep(h)) {
      const b = w.objects.get(h.bunk);
      const bx = b ? b.x + 0.5 : PLACES.bed.x + 0.2;
      const by = b ? b.y + 1.3 : PLACES.bed.y + 1.2;
      if (Math.hypot(bx - h.x, by - h.y) > 0.3) {
        if (r.task?.kind !== 'bed') {
          r.task = { kind: 'bed', x: bx, y: by };
          if (!this.goTo(h, r, bx, by)) {
            h.x = bx;
            h.y = by;
          }
        }
        this.walk(h, r);
        return;
      }
      r.anim = 'dead';
      r.tool = 'none';
      return;
    }
    if (r.task?.kind === 'bed') r.task = null;
    if (r.wounded) {
      r.anim = 'dead';
      return;
    }
    if (h.job === 'guard' && (m >= 20 * 60 || m < 5 * 60 + 30)) {
      this.guardDuty(h, r);
      return;
    }

    const working = m >= 7 * 60 && m < 18 * 60 && h.job === 'tend';
    if (!working) {
      // Evening: sit by the fire
      const fx = PLACES.campfire.x + 0.5 + (h.id.length % 3) - 1;
      const fy = PLACES.campfire.y + 1.6;
      if (r.task?.kind !== 'rest') {
        r.task = { kind: 'rest', x: fx, y: fy };
        this.goTo(h, r, fx, fy);
      }
      if (this.walk(h, r)) {
        r.anim = 'idle';
        this.face(h, PLACES.campfire.x + 0.5, PLACES.campfire.y + 0.5);
      }
      return;
    }

    // Working
    if (r.path.length) {
      this.walk(h, r);
      return;
    }
    if (r.timer > 0) {
      r.timer -= STEP;
      if (r.timer <= 0) this.finishTask(h, r);
      return;
    }
    if (r.task && r.task.kind !== 'rest') {
      // Arrived: start doing it
      const t = r.task;
      this.face(h, t.x + 0.5, t.y + 0.5);
      const slow = h.morale < 30 ? 1.6 : 1;
      if (t.kind === 'harvest') {
        r.anim = 'swing';
        r.tool = 'none';
        r.timer = (1.4 / (0.6 + d.harvest * 0.25)) * slow;
      } else if (t.kind === 'water') {
        r.anim = 'pour';
        r.tool = 'can';
        r.timer = (1.0 / (0.6 + d.water * 0.25)) * slow;
      } else if (t.kind === 'refill' || t.kind === 'deposit') {
        r.anim = 'idle';
        r.timer = 0.8;
      }
      r.animT = 0;
      return;
    }
    // Choose the next job
    const carried = h.carrying.reduce((a, c) => a + c.n, 0);
    const ripe = this.nearestCrop(h, k => !!w.crops.get(k)?.ripe);
    if (carried >= 10 || (carried > 0 && !ripe)) {
      const c = PLACES.crate;
      r.task = { kind: 'deposit', x: c.x, y: c.y };
      if (!this.goTo(h, r, c.x, c.y)) r.task = null;
      return;
    }
    if (ripe) {
      r.task = { kind: 'harvest', x: ripe.x, y: ripe.y, k: ripe.k };
      if (!this.goTo(h, r, ripe.x, ripe.y)) r.task = null;
      return;
    }
    const dry = this.nearestCrop(h, k => !w.wet[k] && !w.crops.get(k)!.ripe);
    if (dry) {
      if (h.water <= 0) {
        const wl = PLACES.well;
        r.task = { kind: 'refill', x: wl.x, y: wl.y };
        if (!this.goTo(h, r, wl.x, wl.y)) r.task = null;
        return;
      }
      r.task = { kind: 'water', x: dry.x, y: dry.y, k: dry.k };
      if (!this.goTo(h, r, dry.x, dry.y)) r.task = null;
      return;
    }
    // Nothing to do: stand about near the field
    r.idleT += STEP;
    r.anim = 'idle';
    r.tool = 'none';
    if (r.idleT > 6) {
      r.idleT = 0;
      const f = PLACES.field;
      const tx = f.x0 - 1 + Math.floor(s.rng() * 4);
      const ty = f.y0 + Math.floor(s.rng() * (f.y1 - f.y0));
      this.goTo(h, r, tx, ty);
    }
  }

  private guardDuty(h: HandState, r: HandRt): void {
    const s = this.sim;
    if (r.attackCd > 0) r.attackCd -= STEP;
    // Nearest Husk within reach of the post
    let best: (typeof s.night.husks)[number] | null = null;
    let bd = 7;
    for (const k of s.night.husks) {
      if (k.state === 'dead' || k.state === 'leave') continue;
      const d = Math.hypot(k.x - h.x, k.y - h.y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best) {
      r.path = [];
      r.task = null;
      if (bd > 0.95) {
        const dx = best.x - h.x;
        const dy = best.y - h.y;
        const sp = SPEED * 1.1 * STEP;
        const nx = h.x + (dx / bd) * sp;
        const ny = h.y + (dy / bd) * sp;
        if (s.world.walkable(Math.floor(nx), Math.floor(h.y), true)) h.x = nx;
        if (s.world.walkable(Math.floor(h.x), Math.floor(ny), true)) h.y = ny;
        this.face(h, best.x, best.y);
        if (r.anim !== 'walk') {
          r.anim = 'walk';
          r.animT = 0;
        }
        r.tool = 'none';
      } else if (r.attackCd <= 0) {
        this.face(h, best.x, best.y);
        r.anim = 'swing';
        r.tool = 'machete';
        r.animT = 0;
        r.attackCd = 0.95;
        const d = this.def(h.id);
        s.night.damage(best, 9 + d.nerve * 3, h.x, h.y, false);
        s.sfx('swish', h.x, h.y, 0.6);
      } else if (r.animT > 0.46) r.anim = 'idle';
      return;
    }
    // Stand at the post by the field, facing out
    const f = PLACES.field;
    const px = f.x1 + 1.5 - (this.sim.state.hands.indexOf(h) % 2) * 3;
    const py = f.y0 - 1.5;
    if (Math.hypot(px - h.x, py - h.y) > 0.4) {
      if (!r.path.length && (r.task?.kind !== 'rest' || r.task.x !== px)) {
        r.task = { kind: 'rest', x: px, y: py };
        this.goTo(h, r, px, py);
      }
      this.walk(h, r);
      return;
    }
    r.anim = 'idle';
    r.tool = 'none';
    h.dir = 7;
  }

  private finishTask(h: HandState, r: HandRt): void {
    const s = this.sim;
    const w = s.world;
    const t = r.task;
    r.task = null;
    r.anim = 'idle';
    r.tool = 'none';
    if (!t) return;
    switch (t.kind) {
      case 'harvest': {
        const got = s.harvestAt(t.x, t.y, h.carrying);
        if (got) {
          s.sfx('harvest', t.x, t.y, 0.5);
          s.emit({ t: 'fx', kind: 'leaf', x: t.x + 0.5, y: t.y + 0.5, z: 6, n: 5 });
        }
        // Merge what they carry
        const merged: typeof h.carrying = [];
        for (const c of h.carrying) {
          const m = merged.find(x => x.id === c.id && (x.q ?? 0) === (c.q ?? 0) && (x.t ?? 0) === (c.t ?? 0));
          if (m) m.n += c.n;
          else merged.push({ ...c });
        }
        h.carrying = merged;
        break;
      }
      case 'water': {
        const k = idx(t.x, t.y);
        if (w.tilled[k] && !w.wet[k]) {
          w.wet[k] = 1;
          const c = w.crops.get(k);
          if (c) c.wet = true;
          h.water--;
          s.emit({ t: 'ground', x: t.x, y: t.y });
          s.emit({ t: 'fx', kind: 'water', x: t.x + 0.5, y: t.y + 0.5, n: 6 });
          s.sfx('water', t.x, t.y, 0.4);
        }
        break;
      }
      case 'refill':
        h.water = CAN;
        s.sfx('refill', t.x, t.y, 0.4);
        break;
      case 'deposit':
        for (const c of h.carrying) {
          const same = s.state.depot.find(d => d.id === c.id && (d.q ?? 0) === (c.q ?? 0) && (d.t ?? 0) === (c.t ?? 0));
          if (same) same.n += c.n;
          else s.state.depot.push({ ...c });
        }
        h.carrying = [];
        s.sfx('drop_crate', t.x, t.y, 0.5);
        break;
    }
  }

  /** Animation state for the renderer. */
  view(h: HandState): { anim: Anim; animT: number; tool: Tool; wounded: boolean } {
    const r = this.runtime(h);
    return { anim: r.anim, animT: r.animT, tool: r.tool, wounded: r.wounded };
  }
}
