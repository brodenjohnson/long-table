// The Sallow Crew: a gang that works the road west of the marsh. They ask for a tithe.
// Pay, and they leave you be for a while. Refuse, and they come for the depot crate that night.
import { STEP } from '../core/config';
import { dirFromScreen, tileToScreenVec } from '../core/iso';
import { CREW, ENEMIES, ITEMS } from '../data';
import type { Anim, Tool } from '../art/rig';
import { removeFromSlot } from './inventory';
import { PLACES } from './worldgen';
import type { Sim } from './sim';

const DEF = ENEMIES.raider;
const R = 0.27;
export const RAID_AT = 22 * 60;
const ENVOY_FROM = 9 * 60;
const ENVOY_TO = 16 * 60 + 30;

export interface Raider {
  id: number;
  x: number;
  y: number;
  dir: number;
  hp: number;
  state: 'approach' | 'loot' | 'chase' | 'windup' | 'strike' | 'stagger' | 'flee' | 'dead';
  t: number;
  anim: Anim;
  animT: number;
  tool: Tool;
  knockX: number;
  knockY: number;
  flash: number;
  carrying: boolean;
  prey: string | null;
  side: number;
}

export class RaiderSystem {
  list: Raider[] = [];
  private nextId = 1;
  private spawnedDay = -1;
  private resolvedDay = -1;
  /** True while the envoy is standing at the gate today. */
  envoyHostile = false;
  /** Raiders who reached the road with stolen goods tonight. */
  private escapedWithLoot = 0;

  constructor(private sim: Sim) {}

  get crew() {
    return this.sim.state.crew;
  }

  /** What the farm is worth to them, which sets the tithe and how often they ask. */
  wealth(): number {
    const s = this.sim;
    const crate = s.trader.depotValue();
    return s.state.player.scrip + crate + s.world.crops.size * 6;
  }

  envoyPos(): { x: number; y: number } | null {
    const s = this.sim;
    const m = s.state.minute;
    if (this.crew.envoyDay !== s.state.day || m < ENVOY_FROM || m > ENVOY_TO) return null;
    return { x: PLACES.gate.x + 2.2, y: PLACES.gate.y + 0.6 };
  }

  /** Called at the start of each day: will they send someone? */
  newDay(): string | null {
    const s = this.sim;
    const st = s.state;
    const c = this.crew;
    if (st.flags.difficulty === 'peaceful') return null;
    if (st.day < 6 || st.day <= c.paidUntil || c.raidDay >= st.day - 2) return null;
    const w = this.wealth();
    const chance = Math.min(0.55, 0.12 + w / 4000) * (c.won > c.lost ? 0.7 : 1);
    if (st.day === 6 || s.rng() < chance) {
      c.envoyDay = st.day;
      c.demand = Math.max(60, Math.round((w * 0.14) / 10) * 10 + c.angry * 20);
      return `A man in a long coat is waiting by the road. He has the look of someone who expects to be paid.`;
    }
    return null;
  }

  pay(): boolean {
    const s = this.sim;
    const c = this.crew;
    if (s.state.player.scrip < c.demand) return false;
    s.state.player.scrip -= c.demand;
    c.paidUntil = s.state.day + 6;
    c.envoyDay = 0;
    s.sfx('coins');
    s.state.journal.push({ day: s.state.day, text: `Paid the ${CREW.name} ${c.demand} scrip to be left alone.` });
    // Hands with nerve do not like it
    for (const h of s.state.hands) if (s.hands.def(h.id).nerve >= 3) h.morale -= 6;
    return true;
  }

  /** Pay in produce instead: worth a little more than the scrip, at Hull prices. */
  payInKind(): boolean {
    const s = this.sim;
    const c = this.crew;
    let need = Math.round(c.demand * 1.25);
    let have = 0;
    for (const st of s.state.inv) if (st && ITEMS[st.id].kind === 'produce') have += s.sellPrice(st) * st.n;
    for (const st of s.state.depot) if (ITEMS[st.id].kind === 'produce') have += s.sellPrice(st) * st.n;
    if (have < need) return false;
    // Take from the crate first, then the bag
    for (let i = s.state.depot.length - 1; i >= 0 && need > 0; i--) {
      const st = s.state.depot[i];
      if (ITEMS[st.id].kind !== 'produce') continue;
      const each = s.sellPrice(st);
      const k = Math.min(st.n, Math.ceil(need / each));
      st.n -= k;
      need -= k * each;
      if (st.n <= 0) s.state.depot.splice(i, 1);
    }
    for (let i = 0; i < s.state.inv.length && need > 0; i++) {
      const st = s.state.inv[i];
      if (!st || ITEMS[st.id].kind !== 'produce') continue;
      const each = s.sellPrice(st);
      const k = Math.min(st.n, Math.ceil(need / each));
      removeFromSlot(s.state.inv, i, k);
      need -= k * each;
    }
    c.paidUntil = s.state.day + 6;
    c.envoyDay = 0;
    s.sfx('drop_crate');
    s.state.journal.push({ day: s.state.day, text: `Paid the ${CREW.name} in produce.` });
    return true;
  }

  refuse(): void {
    const s = this.sim;
    const c = this.crew;
    c.raidDay = s.state.day;
    c.envoyDay = 0;
    c.angry++;
    s.toast(`${CREW.envoy} shrugs. "Lock your crate tonight. Or don't."`, 'bad');
    s.state.journal.push({ day: s.state.day, text: `Told the ${CREW.name} no.` });
  }

  /** You attacked their man. They come tonight, more of them. */
  provoke(): void {
    const c = this.crew;
    c.raidDay = this.sim.state.day;
    c.envoyDay = 0;
    c.angry += 2;
    this.envoyHostile = true;
  }

  update(): void {
    const s = this.sim;
    const st = s.state;
    const c = this.crew;
    if (c.raidDay === st.day && st.minute >= RAID_AT && this.spawnedDay !== st.day && this.resolvedDay !== st.day) {
      this.spawnedDay = st.day;
      const n = Math.min(7, 3 + Math.floor(st.day / 8) + (c.angry > 2 ? 2 : 0));
      this.escapedWithLoot = 0;
      for (let i = 0; i < n; i++) this.spawn(PLACES.truckEnter.x - 1.5 - i * 0.9, PLACES.truckEnter.y + (i % 2 ? 0.7 : -0.7));
      s.toast(`Engines on the road. The ${CREW.name} are coming for the crate.`, 'bad');
      s.sfx('truck_arrive', PLACES.truckEnter.x - 8, PLACES.truckEnter.y);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      this.updateRaider(r);
      if (r.state === 'flee' && r.x > 94) {
        if (r.carrying) this.escapedWithLoot++;
        this.list.splice(i, 1);
      } else if (r.state === 'dead' && r.t > 20) this.list.splice(i, 1);
    }
    // A raid is over when nobody is left fighting
    const active = this.list.some(r => r.state !== 'dead' && r.state !== 'flee');
    if (this.spawnedDay === st.day && this.resolvedDay !== st.day && !active) {
      this.resolvedDay = st.day;
      const stole = this.escapedWithLoot > 0 || this.list.some(r => r.carrying);
      if (stole) {
        c.lost++;
        s.notes.push(`The ${CREW.name} got away with part of the depot crate.`);
      } else {
        c.won++;
        c.angry = Math.max(0, c.angry - 1);
        s.notes.push(`You saw off the ${CREW.name}. They will think twice.`);
        s.toast(`The ${CREW.name} are running. They will remember this.`, 'good');
      }
    }
  }

  spawn(x: number, y: number): Raider {
    const r: Raider = { id: this.nextId++, x, y, dir: 4, hp: DEF.hp, state: 'approach', t: 0, anim: 'walk', animT: 0, tool: 'none', knockX: 0, knockY: 0, flash: 0, carrying: false, prey: null, side: this.sim.rng() < 0.5 ? 1 : -1 };
    this.list.push(r);
    return r;
  }

  private face(r: Raider, x: number, y: number): void {
    const v = tileToScreenVec(x - r.x, y - r.y);
    if (Math.abs(v.x) + Math.abs(v.y) > 0.01) r.dir = dirFromScreen(v.x, v.y);
  }

  private move(r: Raider, dx: number, dy: number): boolean {
    const s = this.sim;
    let moved = false;
    if (!s.blockedCircle(r.x + dx, r.y, R, false)) {
      r.x += dx;
      moved = true;
    }
    if (!s.blockedCircle(r.x, r.y + dy, R, false)) {
      r.y += dy;
      moved = true;
    }
    return moved;
  }

  private steer(r: Raider, gx: number, gy: number, speed: number): void {
    const dx = gx - r.x;
    const dy = gy - r.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) return;
    const vx = (dx / len) * speed * STEP;
    const vy = (dy / len) * speed * STEP;
    if (!this.move(r, vx, vy)) {
      // Break what is in the way if it is a fence, otherwise go round
      const ax = Math.floor(r.x + (dx / len) * 0.6);
      const ay = Math.floor(r.y + (dy / len) * 0.6);
      const o = this.sim.world.objectAt(ax, ay);
      if (o && (o.kind === 'fence' || o.kind === 'gate')) {
        o.hp -= DEF.breakDmg * STEP;
        if (o.hp <= 0) {
          this.sim.world.remove(o);
          this.sim.emit({ t: 'ground', x: o.x, y: o.y });
          this.sim.sfx('break', o.x, o.y);
        }
      } else this.move(r, (-dy / len) * r.side * speed * STEP, (dx / len) * r.side * speed * STEP);
    }
    this.face(r, gx, gy);
    if (r.anim !== 'walk') {
      r.anim = 'walk';
      r.animT = 0;
    }
  }

  private updateRaider(r: Raider): void {
    const s = this.sim;
    r.t += STEP;
    r.animT += STEP;
    if (r.flash > 0) r.flash -= STEP;
    if (r.state === 'dead') return;
    if (r.knockX || r.knockY) {
      this.move(r, r.knockX * STEP, r.knockY * STEP);
      r.knockX *= 0.85;
      r.knockY *= 0.85;
      if (Math.abs(r.knockX) + Math.abs(r.knockY) < 0.05) r.knockX = r.knockY = 0;
    }
    const p = s.player;
    const dP = s.dead ? 99 : Math.hypot(p.x - r.x, p.y - r.y);
    // Nearest guard
    let guard: { id: string; x: number; y: number } | null = null;
    let gd = 99;
    for (const g of s.hands.activeGuards()) {
      const d = Math.hypot(g.x - r.x, g.y - r.y);
      if (d < gd) {
        gd = d;
        guard = g;
      }
    }
    const crate = PLACES.crate;
    switch (r.state) {
      case 'stagger':
        r.anim = 'hurt';
        if (r.t > 0.28) {
          r.state = r.hp < DEF.hp * 0.3 ? 'flee' : 'chase';
          r.t = 0;
        }
        return;
      case 'windup':
        r.anim = 'swing';
        r.tool = 'machete';
        if (r.t >= DEF.windup) {
          r.state = 'strike';
          r.t = 0;
          s.sfx('swish', r.x, r.y);
        }
        return;
      case 'strike': {
        r.anim = 'swing';
        if (r.t > 0.05 && r.t < 0.16) {
          const prey = r.prey ? s.state.hands.find(h => h.id === r.prey) : null;
          if (prey && Math.hypot(prey.x - r.x, prey.y - r.y) < DEF.reach + 0.3) {
            s.hands.hurt(prey, DEF.dmg, r.x, r.y);
            r.prey = null;
          } else if (dP < DEF.reach + 0.3) s.hurtPlayer(DEF.dmg, r.x, r.y);
        }
        if (r.t > DEF.cool * 0.55) {
          r.state = 'chase';
          r.t = 0;
          r.tool = 'none';
        }
        return;
      }
      case 'flee':
        r.tool = 'none';
        this.steer(r, 95.5, r.y < 58 ? 56 : 60, DEF.speed * 1.15);
        return;
      case 'loot':
        r.anim = 'swing';
        r.tool = 'none';
        if (r.t > 2.4) {
          // Take half of whatever is in the crate
          let took = 0;
          for (const st of s.state.depot) {
            const k = Math.ceil(st.n / 2);
            st.n -= k;
            took += k;
          }
          s.state.depot = s.state.depot.filter(st => st.n > 0);
          r.carrying = took > 0;
          if (took) s.toast(`They are emptying the depot crate.`, 'bad');
          r.state = 'flee';
          r.t = 0;
        }
        if (dP < 3) {
          r.state = 'chase';
          r.t = 0;
        }
        return;
    }
    // Choose: fight what is close, otherwise go for the crate
    const threat = Math.min(dP, gd);
    if (threat < 4.5 || r.state === 'chase') {
      if (threat > 8) {
        r.state = 'approach';
        return;
      }
      r.state = 'chase';
      const tx = gd < dP && guard ? guard.x : p.x;
      const ty = gd < dP && guard ? guard.y : p.y;
      r.prey = gd < dP && guard ? guard.id : null;
      if (threat < DEF.reach + 0.1) {
        r.state = 'windup';
        r.t = 0;
        r.animT = 0;
        this.face(r, tx, ty);
        return;
      }
      this.steer(r, tx, ty, DEF.speed);
      return;
    }
    // Approach the crate
    const cd = Math.hypot(crate.x + 0.5 - r.x, crate.y + 1.4 - r.y);
    if (cd < 0.7 && s.state.depot.length) {
      r.state = 'loot';
      r.t = 0;
      r.animT = 0;
      this.face(r, crate.x + 0.5, crate.y + 0.5);
      return;
    }
    if (cd < 0.7) {
      // Nothing in the crate: go for whoever is about
      r.state = 'chase';
      return;
    }
    this.steer(r, crate.x + 0.5 + r.side * 0.4, crate.y + 1.4, DEF.speed);
  }

  damage(r: Raider, dmg: number, fromX: number, fromY: number, loud: boolean): void {
    const s = this.sim;
    r.hp -= dmg;
    r.flash = 0.12;
    const dx = r.x - fromX;
    const dy = r.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    r.knockX = (dx / len) * (loud ? 5 : 3.5);
    r.knockY = (dy / len) * (loud ? 5 : 3.5);
    s.emit({ t: 'fx', kind: 'blood', x: r.x, y: r.y, z: 12, n: 8, dx: dx / len, dy: dy / len });
    s.emit({ t: 'decal', kind: 'splat', x: r.x + (dx / len) * 0.3, y: r.y + (dy / len) * 0.3 });
    s.emit({ t: 'float', text: String(Math.round(dmg)), x: r.x, y: r.y, colour: '#f0c0a0' });
    if (r.hp <= 0) {
      r.state = 'dead';
      r.t = 0;
      r.anim = 'dead';
      r.tool = 'none';
      s.sfx('hurt', r.x, r.y);
      s.emit({ t: 'decal', kind: 'splat', x: r.x, y: r.y });
      s.drop({ id: 'rounds', n: 2 + Math.floor(s.rng() * 4) }, r.x, r.y);
      if (s.rng() < 0.6) s.drop({ id: 'scrap', n: 1 + Math.floor(s.rng() * 2) }, r.x, r.y);
      // What they took, they drop
      if (r.carrying) {
        s.notes.push('You got some of the stolen produce back.');
        r.carrying = false;
      }
      const scrip = 10 + Math.floor(s.rng() * 30);
      s.state.player.scrip += scrip;
      s.emit({ t: 'float', text: `+${scrip} scrip`, x: r.x, y: r.y, colour: '#f0d070' });
      return;
    }
    r.state = 'stagger';
    r.t = 0;
    s.sfx('husk_hit', r.x, r.y, 0.7);
  }

  /** While you sleep through a raid night. */
  resolveOffscreen(): string[] {
    const s = this.sim;
    const st = s.state;
    const c = this.crew;
    const lines: string[] = [];
    if (c.raidDay !== st.day || this.resolvedDay === st.day) {
      this.list = [];
      return lines;
    }
    this.resolvedDay = st.day;
    const left = this.spawnedDay === st.day ? this.list.filter(r => r.state !== 'dead' && r.state !== 'flee').length : Math.min(7, 3 + Math.floor(st.day / 8) + (c.angry > 2 ? 2 : 0));
    this.list = [];
    if (!left) return lines;
    let defence = 0;
    for (const h of st.hands) if (h.job === 'guard') defence += s.hands.def(h.id).nerve;
    const fenced = s.night.fieldEnclosed();
    if (fenced) defence += 2;
    if (defence >= left * 1.5) {
      c.won++;
      lines.push(`The ${CREW.name} came up the road in the night. Your people turned them back at the fence.`);
      return lines;
    }
    c.lost++;
    let took = 0;
    for (const x of st.depot) {
      const k = Math.ceil(x.n * 0.6);
      x.n -= k;
      took += k;
    }
    st.depot = st.depot.filter(x => x.n > 0);
    const scrip = Math.min(150, Math.floor(st.player.scrip * 0.15));
    st.player.scrip -= scrip;
    lines.push(`The ${CREW.name} came in the night.${took ? ` They took ${took} things from the depot crate` : ' The crate was empty'}${scrip ? ` and ${scrip} scrip from the house.` : '.'}`);
    for (const h of st.hands) if (h.job === 'guard' && s.rng() < 0.5) {
      h.morale -= 15;
      lines.push(`${s.hands.def(h.id).name} was beaten trying to stop them.`);
    }
    return lines;
  }
}
