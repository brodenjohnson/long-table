// Husks: failed wakes from the coast, walking toward light and noise after dark.
import { MINUTE_SEC, STEP } from '../core/config';
import { dirFromScreen, tileToScreenVec } from '../core/iso';
import { clamp } from '../core/rng';
import { ENEMIES, OBJECTS } from '../data';
import type { Anim } from '../art/rig';
import { WObject, idx } from './world';
import { PLACES } from './worldgen';
import type { Sim } from './sim';

export interface Husk {
  id: number;
  x: number;
  y: number;
  dir: number;
  hp: number;
  state: 'walk' | 'chase' | 'windup' | 'strike' | 'break' | 'stagger' | 'dead' | 'leave';
  t: number;
  anim: Anim;
  animT: number;
  goalX: number;
  goalY: number;
  knockX: number;
  knockY: number;
  trample: number;
  trapCd: number;
  breakId: number;
  flash: number;
  stuck: number;
  side: number;
  /** A hired hand on guard this Husk is going for, if any. */
  prey: string | null;
}

const DEF = ENEMIES.husk;
const R = 0.26;

export class NightSystem {
  husks: Husk[] = [];
  private nextId = 1;
  private wavesDone = new Set<number>();
  private lastDay = -1;
  /** A loud noise somewhere: Husks within range turn toward it. */
  noise: { x: number; y: number; t: number } | null = null;

  constructor(private sim: Sim) {}

  /** Wave times (game minutes) for tonight. More waves as the days go on. */
  private waveTimes(): number[] {
    const day = this.sim.state.day;
    const n = Math.min(5, 1 + Math.floor(day / 2));
    const all = [21 * 60 + 30, 22 * 60 + 30, 23 * 60 + 20, 24 * 60 + 10, 25 * 60];
    return all.slice(0, n);
  }

  /** How many come in one wave. Grows with the days, with lights, and with what you have built. */
  threat(): number {
    const s = this.sim;
    const w = s.world;
    let lamps = 0;
    for (const o of w.objects.values()) if (o.kind === 'lamp') lamps++;
    const crops = w.crops.size;
    const lantern = s.state.player.lantern ? 0.6 : 0;
    const t = 0.8 + s.state.day * 0.28 + lamps * 0.35 + crops / 45 + lantern;
    return t * (s.state.flags.difficulty === 'hard' ? 1.5 : 1);
  }

  /** True if Husks cannot walk from the edge of the map into the middle of the field without breaking something. */
  fieldEnclosed(): boolean {
    const w = this.sim.world;
    const f = PLACES.field;
    const sx = Math.floor((f.x0 + f.x1) / 2);
    const sy = Math.floor((f.y0 + f.y1) / 2);
    const seen = new Uint8Array(96 * 96);
    const q: number[] = [sy * 96 + sx];
    seen[q[0]] = 1;
    while (q.length) {
      const k = q.pop()!;
      const x = k % 96;
      const y = Math.floor(k / 96);
      if (x <= 2 || y <= 2 || x >= 93 || y >= 93) return false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = ny * 96 + nx;
        if (seen[nk]) continue;
        seen[nk] = 1;
        if (w.walkable(nx, ny, false)) q.push(nk);
      }
    }
    return true;
  }

  /**
   * When you sleep, the rest of the night still happens. Husks still due, and any still walking,
   * are resolved here: traps and guards take some, fences hold some back, and the rest reach the crops.
   */
  resolveOffscreen(): string[] {
    const s = this.sim;
    const st = s.state;
    const w = s.world;
    const lines: string[] = [];
    if (st.flags.difficulty === 'peaceful') {
      this.husks = [];
      return lines;
    }
    let pending = this.husks.filter(h => h.state !== 'dead' && h.state !== 'leave').length;
    for (const at of this.waveTimes()) if (!this.wavesDone.has(at)) pending += clamp(Math.round(this.threat() * (0.7 + s.rng() * 0.4)), 1, 7);
    this.wavesDone = new Set(this.waveTimes());
    this.husks = [];
    if (!pending) return lines;
    let traps = 0;
    let lampsOut = 0;
    const fences: WObject[] = [];
    const f = PLACES.field;
    for (const o of w.objects.values()) {
      if (o.kind === 'spike_trap') traps++;
      if (o.kind === 'lamp' && (o.x < f.x0 - 1 || o.x > f.x1 + 1 || o.y < f.y0 - 1 || o.y > f.y1 + 1)) lampsOut++;
      if (o.kind === 'fence' || o.kind === 'gate') fences.push(o);
    }
    const trapped = Math.min(pending, Math.round(traps * 0.45 * (0.6 + s.rng() * 0.8)));
    pending -= trapped;
    // Hands on guard
    const guardLines = s.hands.resolveGuards(pending);
    pending -= guardLines.kills;
    // Fences
    const enclosed = fences.length >= 8 && this.fieldEnclosed();
    let reached = 0;
    let broken = 0;
    for (let i = 0; i < pending; i++) {
      if (!enclosed) reached++;
      else {
        // They batter at the fence; some get through
        const fc = fences[Math.floor(s.rng() * fences.length)];
        if (fc && w.objects.has(fc.id)) {
          fc.hp -= 8 + Math.floor(s.rng() * 10);
          if (fc.hp <= 0) {
            w.remove(fc);
            broken++;
            reached++;
          }
        }
        if (s.rng() < 0.15) reached++;
      }
    }
    // Lamps away from the field draw some of them off
    reached = Math.round(reached * Math.max(0.35, 1 - lampsOut * 0.15));
    const live = [...w.crops.entries()].filter(([, c]) => !c.dead).map(([k]) => k);
    // A small patch is easy to miss in the dark; the first nights are kinder
    const findChance = Math.min(1, 0.25 + live.length / 30) * (st.day <= 2 ? 0.5 : 1);
    let trampled = 0;
    for (let i = 0; i < reached && live.length; i++) {
      if (s.rng() > findChance) continue;
      const n = 1 + Math.floor(s.rng() * 2);
      for (let j = 0; j < n && live.length; j++) {
        const at = Math.floor(s.rng() * live.length);
        const c = w.crops.get(live[at])!;
        c.dead = true;
        c.ripe = false;
        live.splice(at, 1);
        trampled++;
      }
    }
    st.flags.trampled = Number(st.flags.trampled ?? 0) + trampled;
    st.stats.husks += trapped + guardLines.kills;
    if (trapped) lines.push(`Your spike traps caught ${trapped} ${trapped === 1 ? 'Husk' : 'Husks'} in the night.`);
    lines.push(...guardLines.lines);
    if (broken) lines.push(`${broken} ${broken === 1 ? 'fence section was' : 'fence sections were'} battered down.`);
    if (enclosed && !broken && reached === 0 && pending > 0) lines.push('Husks came to the fence in the night. It held.');
    return lines;
  }

  update(): void {
    const s = this.sim;
    const st = s.state;
    if (this.lastDay !== st.day) {
      this.lastDay = st.day;
      this.wavesDone.clear();
      this.husks = [];
    }
    if (st.flags.difficulty === 'peaceful') return;
    // Waves
    for (const at of this.waveTimes()) {
      if (st.minute >= at && !this.wavesDone.has(at) && st.minute < at + 30) {
        this.wavesDone.add(at);
        const n = clamp(Math.round(this.threat() * (0.7 + s.rng() * 0.4)), 1, 7);
        for (let i = 0; i < n; i++) this.spawn();
        if (!st.flags.firstNight) {
          st.flags.firstNight = 1;
          s.toast('Something is moving out past the ruins. Husks come to light and noise.', 'bad');
        }
        s.sfx('husk_far', undefined, undefined, 0.8);
      }
    }
    if (this.noise) {
      this.noise.t -= STEP;
      if (this.noise.t <= 0) this.noise = null;
    }
    const dawn = st.minute % (24 * 60) >= 5 * 60 + 20 && st.minute % (24 * 60) < 12 * 60;
    for (let i = this.husks.length - 1; i >= 0; i--) {
      const h = this.husks[i];
      this.updateHusk(h, dawn);
      if (h.state === 'dead' && h.t > 18) this.husks.splice(i, 1);
      if (h.state === 'leave' && h.t > 25) this.husks.splice(i, 1);
    }
  }

  spawn(at?: { x: number; y: number }): Husk {
    const s = this.sim;
    const sp = at ?? PLACES.huskSpawns[Math.floor(s.rng() * PLACES.huskSpawns.length)];
    const h: Husk = {
      id: this.nextId++,
      x: sp.x + (s.rng() - 0.5) * 3,
      y: sp.y + (s.rng() - 0.5) * 3,
      dir: 3,
      hp: DEF.hp,
      state: 'walk',
      t: 0,
      anim: 'walk',
      animT: s.rng(),
      goalX: PLACES.field.x0 + 6,
      goalY: PLACES.field.y0 + 6,
      knockX: 0,
      knockY: 0,
      trample: 0,
      trapCd: 0,
      breakId: 0,
      flash: 0,
      stuck: 0,
      side: s.rng() < 0.5 ? 1 : -1,
      prey: null
    };
    this.husks.push(h);
    return h;
  }

  /** What draws this Husk: the player if seen, else the nearest light or noise, else the field. */
  private chooseGoal(h: Husk): boolean {
    const s = this.sim;
    const p = s.player;
    const dP = Math.hypot(p.x - h.x, p.y - h.y);
    const sight = s.state.player.lantern ? DEF.lampSight : DEF.sight;
    h.prey = null;
    // A guard closer than the player draws it first
    let gd = Infinity;
    let guard: { id: string; x: number; y: number } | null = null;
    for (const g of s.hands.activeGuards()) {
      const d = Math.hypot(g.x - h.x, g.y - h.y);
      if (d < DEF.sight && d < gd) {
        gd = d;
        guard = g;
      }
    }
    if (guard && (s.dead || gd < dP)) {
      h.goalX = guard.x;
      h.goalY = guard.y;
      h.prey = guard.id;
      return true;
    }
    if (!s.dead && dP < sight) {
      h.goalX = p.x;
      h.goalY = p.y;
      return true;
    }
    if (this.noise && Math.hypot(this.noise.x - h.x, this.noise.y - h.y) < 22) {
      h.goalX = this.noise.x;
      h.goalY = this.noise.y;
      return false;
    }
    let best = Infinity;
    for (const o of s.world.objects.values()) {
      const d = OBJECTS[o.kind];
      if (!d.light) continue;
      const dist = Math.hypot(o.x + 0.5 - h.x, o.y + 0.5 - h.y);
      if (dist < DEF.lampSight * 1.6 && dist < best) {
        best = dist;
        h.goalX = o.x + 0.5 + h.side * 0.8;
        h.goalY = o.y + 0.5;
      }
    }
    if (best === Infinity) {
      // Wander toward the crops
      const f = PLACES.field;
      if (Math.hypot(h.goalX - h.x, h.goalY - h.y) < 1.5) {
        h.goalX = f.x0 + s.rng() * (f.x1 - f.x0);
        h.goalY = f.y0 + s.rng() * (f.y1 - f.y0);
      }
    }
    return false;
  }

  private updateHusk(h: Husk, dawn: boolean): void {
    const s = this.sim;
    const w = s.world;
    h.t += STEP;
    h.animT += STEP;
    if (h.flash > 0) h.flash -= STEP;
    if (h.trapCd > 0) h.trapCd -= STEP;
    if (h.state === 'dead') return;

    // Knockback
    if (h.knockX || h.knockY) {
      this.moveHusk(h, h.knockX * STEP, h.knockY * STEP);
      h.knockX *= 0.85;
      h.knockY *= 0.85;
      if (Math.abs(h.knockX) + Math.abs(h.knockY) < 0.05) h.knockX = h.knockY = 0;
    }

    if (dawn && h.state !== 'leave') {
      h.state = 'leave';
      h.t = 0;
      const sp = PLACES.huskSpawns[0];
      h.goalX = sp.x;
      h.goalY = sp.y;
    }

    // Spike traps
    const k = idx(Math.floor(h.x), Math.floor(h.y));
    const under = w.objAt[k] ? w.objects.get(w.objAt[k]) : undefined;
    if (under && under.kind === 'spike_trap' && h.trapCd <= 0) {
      h.trapCd = 1.2;
      this.damage(h, 16, h.x - 0.1, h.y - 0.1, false);
      s.sfx('spike', h.x, h.y);
      if (h.hp <= 0) return;
    }

    // Trample crops
    const crop = w.crops.get(k);
    if (crop && !crop.dead && h.state !== 'stagger') {
      h.trample += STEP;
      if (h.trample > 1.1) {
        h.trample = 0;
        crop.dead = true;
        crop.ripe = false;
        s.emit({ t: 'ground', x: Math.floor(h.x), y: Math.floor(h.y) });
        s.emit({ t: 'fx', kind: 'leaf', x: h.x, y: h.y, z: 4, n: 6 });
        s.state.flags.trampled = Number(s.state.flags.trampled ?? 0) + 1;
      }
    } else h.trample = 0;

    const p = s.player;
    const dP = Math.hypot(p.x - h.x, p.y - h.y);
    switch (h.state) {
      case 'stagger':
        h.anim = 'hurt';
        if (h.t > 0.32) {
          h.state = 'walk';
          h.t = 0;
        }
        return;
      case 'windup':
        h.anim = 'claw';
        h.animT = Math.min(h.t / DEF.windup, 0.99) * 0.5 * 4 * 0.12; // frames 0..1 over the windup
        if (h.t >= DEF.windup) {
          h.state = 'strike';
          h.t = 0;
          s.sfx('husk_swing', h.x, h.y);
          // Lunge
          const dx = p.x - h.x;
          const dy = p.y - h.y;
          const len = Math.hypot(dx, dy) || 1;
          h.knockX = (dx / len) * DEF.lunge;
          h.knockY = (dy / len) * DEF.lunge;
        }
        return;
      case 'strike':
        h.anim = 'claw';
        h.animT = 0.25 + Math.min(h.t, 0.24);
        if (h.t > 0.08 && h.t < 0.2) {
          const prey = h.prey ? s.state.hands.find(x => x.id === h.prey) : null;
          if (prey && Math.hypot(prey.x - h.x, prey.y - h.y) < DEF.reach + 0.25) {
            s.hands.hurt(prey, DEF.dmg, h.x, h.y);
            h.prey = null;
          } else if (dP < DEF.reach + 0.25) s.hurtPlayer(DEF.dmg, h.x, h.y);
        }
        if (h.t > DEF.cool * 0.6) {
          h.state = 'chase';
          h.t = 0;
        }
        return;
      case 'break': {
        const o = w.objects.get(h.breakId);
        h.anim = 'claw';
        if (!o) {
          h.state = 'walk';
          h.t = 0;
          return;
        }
        if (h.t > 1.1) {
          h.t = 0;
          h.animT = 0;
          o.hp -= DEF.breakDmg;
          s.sfx('bash', o.x, o.y, 0.8);
          s.emit({ t: 'fx', kind: 'chip', x: o.x + 0.5, y: o.y + 0.5, z: 6, n: 5 });
          if (o.hp <= 0) {
            w.remove(o);
            s.emit({ t: 'ground', x: o.x, y: o.y });
            s.sfx('break', o.x, o.y);
            h.state = 'walk';
          }
        }
        if (dP < 1.4) {
          h.state = 'chase';
          h.t = 0;
        }
        return;
      }
    }

    // Walking, chasing or leaving
    const chasing = h.state !== 'leave' && this.chooseGoal(h);
    if (chasing) h.state = 'chase';
    else if (h.state === 'chase') h.state = 'walk';
    const dT = h.prey ? Math.hypot(h.goalX - h.x, h.goalY - h.y) : dP;
    if (h.state === 'chase' && dT < DEF.reach + 0.15 && (h.prey || !s.dead)) {
      h.state = 'windup';
      h.t = 0;
      h.animT = 0;
      this.face(h, h.goalX, h.goalY);
      s.sfx('husk_growl', h.x, h.y, 0.7);
      return;
    }
    const dx = h.goalX - h.x;
    const dy = h.goalY - h.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.2) {
      const sp = DEF.speed * (h.state === 'chase' ? 1.25 : 1) * (h.state === 'leave' ? 1.1 : 1);
      // Shamble: speed pulses
      const pulse = 0.65 + 0.35 * Math.abs(Math.sin(h.animT * 3.2));
      const vx = (dx / len) * sp * pulse * STEP;
      const vy = (dy / len) * sp * pulse * STEP;
      const moved = this.moveHusk(h, vx, vy);
      if (!moved) {
        h.stuck += STEP;
        // Something solid in the way: break it if it can be broken, otherwise slide around it
        const ax = Math.floor(h.x + (dx / len) * 0.6);
        const ay = Math.floor(h.y + (dy / len) * 0.6);
        const o = w.objectAt(ax, ay);
        if (o && OBJECTS[o.kind].husksBreak) {
          h.state = 'break';
          h.breakId = o.id;
          h.t = 0;
          this.face(h, o.x + 0.5, o.y + 0.5);
          return;
        }
        const side = h.side;
        this.moveHusk(h, (-dy / len) * side * DEF.speed * STEP, (dx / len) * side * DEF.speed * STEP);
        if (h.stuck > 2) {
          h.side = -h.side;
          h.stuck = 0;
        }
      } else h.stuck = 0;
      this.face(h, h.goalX, h.goalY);
      h.anim = 'walk';
    } else h.anim = 'idle';
  }

  private face(h: Husk, x: number, y: number): void {
    const v = tileToScreenVec(x - h.x, y - h.y);
    if (Math.abs(v.x) + Math.abs(v.y) > 0.01) h.dir = dirFromScreen(v.x, v.y);
  }

  private moveHusk(h: Husk, dx: number, dy: number): boolean {
    const s = this.sim;
    let moved = false;
    if (!s.blockedCircle(h.x + dx, h.y, R, false)) {
      h.x += dx;
      moved = true;
    }
    if (!s.blockedCircle(h.x, h.y + dy, R, false)) {
      h.y += dy;
      moved = true;
    }
    // Keep Husks from stacking on each other
    for (const o of this.husks) {
      if (o === h || o.state === 'dead') continue;
      const ex = h.x - o.x;
      const ey = h.y - o.y;
      const d = Math.hypot(ex, ey);
      if (d < 0.5 && d > 0.001) {
        h.x += (ex / d) * (0.5 - d) * 0.5;
        h.y += (ey / d) * (0.5 - d) * 0.5;
      }
    }
    return moved;
  }

  damage(h: Husk, dmg: number, fromX: number, fromY: number, loud: boolean): void {
    const s = this.sim;
    h.hp -= dmg;
    h.flash = 0.12;
    const dx = h.x - fromX;
    const dy = h.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    h.knockX = (dx / len) * (loud ? 6 : 4.5);
    h.knockY = (dy / len) * (loud ? 6 : 4.5);
    s.emit({ t: 'fx', kind: 'blood', x: h.x, y: h.y, z: 12, n: 8, dx: dx / len, dy: dy / len });
    s.emit({ t: 'decal', kind: 'splat', x: h.x + (dx / len) * 0.3, y: h.y + (dy / len) * 0.3 });
    s.emit({ t: 'float', text: String(Math.round(dmg)), x: h.x, y: h.y, colour: '#f0c0a0' });
    if (h.hp <= 0) {
      h.state = 'dead';
      h.t = 0;
      h.anim = 'dead';
      h.animT = 0;
      s.state.stats.husks++;
      s.sfx('husk_die', h.x, h.y);
      s.emit({ t: 'fx', kind: 'blood', x: h.x, y: h.y, z: 8, n: 16 });
      s.emit({ t: 'decal', kind: 'splat', x: h.x, y: h.y });
      // What they had on them
      const r = s.rng();
      if (r < 0.3) s.drop({ id: 'scrap', n: 1 }, h.x, h.y);
      else if (r < 0.45) s.drop({ id: 'cloth', n: 1 }, h.x, h.y);
      else if (r < 0.52) s.drop({ id: 'rounds', n: 2 + Math.floor(s.rng() * 3) }, h.x, h.y);
      if (!s.state.flags.firstKill) {
        s.state.flags.firstKill = 1;
        s.toast('It was a person once. The gown is the same grey the Cradle issued.', 'info');
      }
      return;
    }
    h.state = 'stagger';
    h.t = 0;
    s.sfx('husk_hit', h.x, h.y);
  }

  /** A melee swing from the player. Returns true if anything was hit. */
  meleeHit(px: number, py: number, ax: number, ay: number, reach: number, arc: number, dmg: number): boolean {
    const s = this.sim;
    let aimA = Math.atan2(ay - py, ax - px);
    // Aim straight ahead if the pointer is on the player
    if (Math.hypot(ax - px, ay - py) < 0.2) aimA = (s.player.dir * Math.PI) / 4;
    let any = false;
    for (const h of this.husks) {
      if (h.state === 'dead' || h.state === 'leave') continue;
      const d = Math.hypot(h.x - px, h.y - py);
      if (d > reach + R) continue;
      const a = Math.atan2(h.y - py, h.x - px);
      let diff = Math.abs(a - aimA);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > arc / 2 && d > 0.5) continue;
      this.damage(h, dmg * (0.9 + s.rng() * 0.2), px, py, false);
      any = true;
    }
    if (any) {
      s.emit({ t: 'hitstop', ms: 55 });
      s.emit({ t: 'shake', amt: 1.4 });
      s.sfx('slash_hit');
    }
    return any;
  }

  /** A pistol shot along a line. Stops at the first Husk or solid object. Wakes up everything nearby. */
  shoot(px: number, py: number, ax: number, ay: number, range: number, dmg: number): void {
    const s = this.sim;
    let dx = ax - px;
    let dy = ay - py;
    let len = Math.hypot(dx, dy);
    if (len < 0.2) {
      const a = (s.player.dir * Math.PI) / 4;
      const v = { x: Math.cos(a), y: Math.sin(a) };
      dx = v.x / 32 + v.y / 16;
      dy = v.y / 16 - v.x / 32;
      len = Math.hypot(dx, dy);
    }
    dx /= len;
    dy /= len;
    let hitT = range;
    let target: Husk | null = null;
    for (const h of this.husks) {
      if (h.state === 'dead') continue;
      const rx = h.x - px;
      const ry = h.y - py;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > hitT) continue;
      const perp = Math.abs(rx * dy - ry * dx);
      if (perp < 0.42) {
        hitT = t;
        target = h;
      }
    }
    // Walls and trees stop the shot
    for (let t = 0.4; t < hitT; t += 0.2) {
      const x = Math.floor(px + dx * t);
      const y = Math.floor(py + dy * t);
      const o = s.world.objectAt(x, y);
      if (o && OBJECTS[o.kind].solid && OBJECTS[o.kind].w === 1 && !['fence', 'spike_trap'].includes(o.kind)) {
        hitT = t;
        target = null;
        s.emit({ t: 'fx', kind: 'spark', x: px + dx * t, y: py + dy * t, z: 10, n: 4 });
        break;
      }
    }
    s.emit({ t: 'tracer', x0: px + dx * 0.5, y0: py + dy * 0.5, x1: px + dx * hitT, y1: py + dy * hitT });
    s.emit({ t: 'shake', amt: 2 });
    s.sfx('shot');
    s.emit({ t: 'fx', kind: 'muzzle', x: px + dx * 0.6, y: py + dy * 0.6, z: 14, n: 1 });
    this.noise = { x: px, y: py, t: 12 };
    if (target) {
      this.damage(target, dmg, px, py, true);
      s.emit({ t: 'hitstop', ms: 60 });
    }
    void MINUTE_SEC;
  }
}
