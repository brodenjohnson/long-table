// The simulation: one fixed step at a time, no drawing. The renderer and UI read it; input drives it.
import { DAY_END, MAP_H, MAP_W, MINUTE_SEC, STEP } from '../core/config';
import { dirFromScreen, screenToTileVec, tileToScreenVec } from '../core/iso';
import { clamp, mulberry32, Rng } from '../core/rng';
import { CROPS, ITEMS, OBJECTS, QUALITY_MULT, TAINT_MULT, baseSell } from '../data';
import type { Anim, Tool } from '../art/rig';
import { addItem, countItem, removeFromSlot } from './inventory';
import { GameState, Stack, seasonOf } from './state';
import { Crop, T, WObject, World, idx, inMap } from './world';
import { PLACES } from './worldgen';
import { NightSystem } from './night';
import { HandSystem } from './hands';
import { TraderSystem } from './trader';
import { endDay } from './day';

export interface InputFrame {
  /** Screen-space movement, x right, y down, length up to 1. */
  moveX: number;
  moveY: number;
  /** World tile position under the pointer, if there is a pointer. */
  aim: { x: number; y: number } | null;
  use: boolean;
  usePressed: boolean;
  interact: boolean;
  dodge: boolean;
  lantern: boolean;
}

export const NO_INPUT: InputFrame = { moveX: 0, moveY: 0, aim: null, use: false, usePressed: false, interact: false, dodge: false, lantern: false };

export type SimEvent =
  | { t: 'sfx'; name: string; x?: number; y?: number; vol?: number }
  | { t: 'toast'; text: string; kind?: 'info' | 'good' | 'bad' }
  | { t: 'fx'; kind: string; x: number; y: number; z?: number; n?: number; dx?: number; dy?: number }
  | { t: 'decal'; kind: string; x: number; y: number }
  | { t: 'shake'; amt: number }
  | { t: 'hitstop'; ms: number }
  | { t: 'open'; what: 'depot' | 'shop' | 'hire' | 'hand' | 'sleep' | 'compost' | 'radio'; id?: string }
  | { t: 'dayEnded'; passedOut: boolean }
  | { t: 'tracer'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'ground'; x: number; y: number }
  | { t: 'float'; text: string; x: number; y: number; colour?: string }
  | { t: 'hit'; id: number };

export interface Actor {
  x: number;
  y: number;
  dir: number;
  anim: Anim;
  animT: number;
  tool: Tool;
}

export interface Action {
  kind: 'swing' | 'pour' | 'shoot';
  tool: Tool;
  item: string;
  slot: number;
  t: number;
  dur: number;
  hitAt: number;
  done: boolean;
  tx: number;
  ty: number;
  aimX: number;
  aimY: number;
}

export interface Pickup {
  id: number;
  item: Stack;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

const REACH = 1.75;
const PLAYER_R = 0.24;
const WALK_PX = 62; // native pixels per second on screen

export class Sim {
  readonly world: World;
  state: GameState;
  readonly events: SimEvent[] = [];
  readonly rng: Rng;
  readonly player: Actor = { x: 0, y: 0, dir: 2, anim: 'idle', animT: 0, tool: 'none' };
  action: Action | null = null;
  roll: { vx: number; vy: number; t: number } | null = null;
  invuln = 0;
  hurtT = 0;
  knock = { x: 0, y: 0 };
  cooldown = 0;
  regenT = 0;
  dead = false;
  deadT = 0;
  /** Seconds the player has stood still, for idle animation. */
  pickups: Pickup[] = [];
  nextPickup = 1;
  readonly night: NightSystem;
  readonly hands: HandSystem;
  readonly trader: TraderSystem;
  /** Simulation time, seconds. */
  time = 0;
  /** Set when the day should end at the next step. */
  private pendingEnd: { passedOut: boolean } | null = null;
  /** Tile the player is pointing at, for the cursor. */
  target: { x: number; y: number; ok: boolean; kind: string } | null = null;
  /** Interaction hint for the UI ("E: Sleep"). */
  hint = '';
  /** Things that happened during the day or night that belong in the next morning report. */
  notes: string[] = [];

  constructor(world: World, state: GameState) {
    this.world = world;
    this.state = state;
    this.rng = mulberry32(state.seed ^ (state.day * 7919));
    this.player.x = state.player.x;
    this.player.y = state.player.y;
    this.player.dir = state.player.dir;
    this.night = new NightSystem(this);
    this.hands = new HandSystem(this);
    this.trader = new TraderSystem(this);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    this.emit({ t: 'toast', text, kind });
  }

  sfx(name: string, x?: number, y?: number, vol?: number): void {
    this.emit({ t: 'sfx', name, x, y, vol });
  }

  get season() {
    return seasonOf(this.state.day);
  }

  /** Night: from 20:30 to 05:30. Hour 0..24 can exceed 24 after midnight. */
  get hour(): number {
    return this.state.minute / 60;
  }

  isNight(): boolean {
    const h = this.hour % 24;
    return h >= 20.5 || h < 5.5;
  }

  selected(): Stack | null {
    return this.state.inv[this.state.sel];
  }

  // ------------------------------------------------------------------ step

  step(input: InputFrame): void {
    this.time += STEP;
    if (this.pendingEnd) {
      const p = this.pendingEnd;
      this.pendingEnd = null;
      endDay(this, p.passedOut);
      return;
    }
    // Clock
    this.state.minute += STEP / MINUTE_SEC;
    if (this.state.minute >= DAY_END && !this.dead) {
      this.toast('You can barely stand. The night takes you where you fall.', 'bad');
      this.pendingEnd = { passedOut: true };
    }
    this.updatePlayer(input);
    this.updatePickups();
    this.night.update();
    this.hands.update();
    this.trader.update();
    this.updateTarget(input);
    // Write back to the saved player state
    const ps = this.state.player;
    ps.x = this.player.x;
    ps.y = this.player.y;
    ps.dir = this.player.dir;
  }

  requestSleep(): void {
    if (!this.pendingEnd) this.pendingEnd = { passedOut: false };
  }

  // ------------------------------------------------------------------ player

  private updatePlayer(input: InputFrame): void {
    const p = this.player;
    const ps = this.state.player;
    p.animT += STEP;
    if (this.invuln > 0) this.invuln -= STEP;
    if (this.cooldown > 0) this.cooldown -= STEP;
    if (this.hurtT > 0) this.hurtT -= STEP;

    if (this.dead) {
      p.anim = 'dead';
      this.deadT += STEP;
      if (this.deadT > 2.5) {
        this.dead = false;
        this.deadT = 0;
        this.pendingEnd = { passedOut: true };
        this.state.flags.downed = 1;
      }
      return;
    }

    if (input.lantern) {
      ps.lantern = !ps.lantern;
      this.sfx(ps.lantern ? 'lantern_on' : 'lantern_off');
      if (ps.lantern && this.isNight() && !this.state.flags.lanternHint) {
        this.state.flags.lanternHint = 1;
        this.toast('Husks see a lit lantern from a long way off.', 'info');
      }
    }

    // Knockback
    if (this.knock.x || this.knock.y) {
      this.moveBy(this.knock.x * STEP, this.knock.y * STEP, PLAYER_R, true);
      this.knock.x *= 0.82;
      this.knock.y *= 0.82;
      if (Math.abs(this.knock.x) + Math.abs(this.knock.y) < 0.05) this.knock.x = this.knock.y = 0;
    }

    // Dodge roll
    if (this.roll) {
      this.roll.t -= STEP;
      this.moveBy(this.roll.vx * STEP, this.roll.vy * STEP, PLAYER_R, true);
      p.anim = 'roll';
      if (this.roll.t <= 0) this.roll = null;
      return;
    }
    if (input.dodge && !this.action && ps.stamina > 0) {
      let mx = input.moveX;
      let my = input.moveY;
      if (!mx && !my) {
        const a = (p.dir * Math.PI) / 4;
        mx = Math.cos(a);
        my = Math.sin(a);
      }
      const len = Math.hypot(mx, my) || 1;
      const v = screenToTileVec((mx / len) * WALK_PX * 2.4, (my / len) * WALK_PX * 2.4);
      this.roll = { vx: v.x, vy: v.y, t: 0.34 };
      this.invuln = Math.max(this.invuln, 0.36);
      p.animT = 0;
      this.spendStamina(6);
      this.sfx('roll');
      this.emit({ t: 'fx', kind: 'dust', x: p.x, y: p.y, n: 6 });
      return;
    }

    // Current action
    if (this.action) {
      this.updateAction();
      return;
    }

    // Movement
    const mx = input.moveX;
    const my = input.moveY;
    const moving = Math.abs(mx) + Math.abs(my) > 0.05;
    if (moving) {
      const exhausted = ps.stamina <= 0 ? 0.72 : 1;
      const len = Math.max(1, Math.hypot(mx, my));
      const v = screenToTileVec((mx / len) * WALK_PX * exhausted, (my / len) * WALK_PX * exhausted);
      this.moveBy(v.x * STEP, v.y * STEP, PLAYER_R, true);
      p.dir = dirFromScreen(mx, my);
      if (p.anim !== 'walk') {
        p.anim = 'walk';
        p.animT = 0;
      }
      // Footsteps
      const stepPeriod = 0.32;
      if (Math.floor(p.animT / stepPeriod) !== Math.floor((p.animT - STEP) / stepPeriod)) {
        const t = this.world.terrain[idx(Math.floor(p.x), Math.floor(p.y))];
        this.sfx(t === T.Water ? 'step_water' : t === T.Road || t === T.Concrete ? 'step_hard' : 'step', p.x, p.y, 0.35);
        if (t === T.Dirt || t === T.Dry || t === T.Track || t === T.Sand || t === T.Ash) this.emit({ t: 'fx', kind: 'dust', x: p.x, y: p.y, n: 1 });
        if (t === T.Water) this.emit({ t: 'fx', kind: 'splash', x: p.x, y: p.y, n: 2 });
      }
    } else if (p.anim !== 'idle') {
      p.anim = 'idle';
      p.animT = 0;
    }

    // Standing in bad water or ash raises the dose
    const k = idx(Math.floor(p.x), Math.floor(p.y));
    const terr = this.world.terrain[k];
    const c = this.world.contam[k];
    if ((terr === T.Water && c > 0.4) || (terr === T.Ash && c > 0.55)) this.addDose(STEP * (terr === T.Water ? 1.6 : 0.6));

    // Slow healing when not hurt recently
    this.regenT += STEP;
    if (this.regenT > 6 && ps.hp < this.maxHp()) {
      this.regenT = 0;
      ps.hp = Math.min(this.maxHp(), ps.hp + 1);
    }

    if (input.interact) this.interact(input);
    else if (input.usePressed || (input.use && this.cooldown <= 0)) this.useSelected(input);
  }

  maxHp(): number {
    const ps = this.state.player;
    return Math.round(ps.maxHp - Math.max(0, ps.dose - 40) * 0.6);
  }

  addDose(n: number): void {
    const ps = this.state.player;
    const before = ps.dose;
    ps.dose = clamp(ps.dose + n, 0, 100);
    if (before < 40 && ps.dose >= 40) this.toast('Your band clicks faster. The dose is starting to cost you health.', 'bad');
    ps.hp = Math.min(ps.hp, this.maxHp());
  }

  spendStamina(n: number): void {
    const ps = this.state.player;
    const before = ps.stamina;
    ps.stamina = Math.max(0, ps.stamina - n);
    if (before > 0 && ps.stamina <= 0) this.toast('You are spent. Eat something or get some sleep.', 'bad');
    else if (before > 20 && ps.stamina <= 20) this.toast('You are getting tired.', 'info');
  }

  /** Moves a body with collision against solid tiles, sliding along walls. */
  moveBy(dx: number, dy: number, r: number, friendly: boolean): void {
    const p = this.player;
    const tryMove = (nx: number, ny: number) => !this.blockedCircle(nx, ny, r, friendly);
    if (tryMove(p.x + dx, p.y)) p.x += dx;
    if (tryMove(p.x, p.y + dy)) p.y += dy;
    p.x = clamp(p.x, 1.3, MAP_W - 1.3);
    p.y = clamp(p.y, 1.3, MAP_H - 1.3);
  }

  blockedCircle(x: number, y: number, r: number, friendly: boolean): boolean {
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r);
    const y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (this.world.walkable(tx, ty, friendly)) continue;
        // Circle against the tile square
        const cx = clamp(x, tx, tx + 1);
        const cy = clamp(y, ty, ty + 1);
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    // The parked truck is solid
    const tr = this.trader.truckBox();
    if (tr && x + r > tr.x0 && x - r < tr.x1 && y + r > tr.y0 && y - r < tr.y1) return true;
    return false;
  }

  /** The tile in front of the player. */
  frontTile(): { x: number; y: number } {
    const p = this.player;
    const a = (p.dir * Math.PI) / 4;
    const v = screenToTileVec(Math.cos(a), Math.sin(a));
    const len = Math.hypot(v.x, v.y) || 1;
    return { x: Math.floor(p.x + (v.x / len) * 0.85), y: Math.floor(p.y + (v.y / len) * 0.85) };
  }

  /** The tile the player means: the pointed tile if close enough, otherwise the one in front. */
  aimTile(input: InputFrame): { x: number; y: number } {
    const p = this.player;
    if (input.aim) {
      const tx = Math.floor(input.aim.x);
      const ty = Math.floor(input.aim.y);
      if (Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) <= REACH) return { x: tx, y: ty };
    }
    return this.frontTile();
  }

  private faceToward(x: number, y: number): void {
    const p = this.player;
    const s = tileToScreenVec(x - p.x, y - p.y);
    if (Math.abs(s.x) + Math.abs(s.y) > 0.01) p.dir = dirFromScreen(s.x, s.y);
  }

  // ------------------------------------------------------------------ using things

  private startAction(kind: Action['kind'], tool: Tool, item: string, dur: number, hitAt: number, tx: number, ty: number, aim: { x: number; y: number }): void {
    this.action = { kind, tool, item, slot: this.state.sel, t: 0, dur, hitAt, done: false, tx, ty, aimX: aim.x, aimY: aim.y };
    this.player.anim = kind;
    this.player.tool = tool;
    this.player.animT = 0;
  }

  private updateAction(): void {
    const a = this.action!;
    const p = this.player;
    a.t += STEP;
    p.animT = a.t;
    if (!a.done && a.t >= a.dur * a.hitAt) {
      a.done = true;
      this.resolveAction(a);
    }
    if (a.t >= a.dur) {
      this.action = null;
      p.anim = 'idle';
      p.animT = 0;
      p.tool = 'none';
    }
  }

  private useSelected(input: InputFrame): void {
    const s = this.selected();
    const p = this.player;
    const ps = this.state.player;
    if (!s) return;
    const def = ITEMS[s.id];
    const tile = this.aimTile(input);
    const aim = input.aim ?? { x: tile.x + 0.5, y: tile.y + 0.5 };
    // Harvest takes priority when pointing at something ripe, unless holding a weapon
    if (def.kind !== 'weapon' && input.usePressed && this.tryHarvest(tile.x, tile.y)) return;

    switch (def.kind) {
      case 'tool': {
        this.faceToward(tile.x + 0.5, tile.y + 0.5);
        if (s.id === 'can' || s.id === 'can2') {
          if (this.canRefillAt(tile.x, tile.y)) {
            ps.water = this.canSize();
            this.startAction('pour', 'can', s.id, 0.45, 0.5, tile.x, tile.y, aim);
            this.sfx('refill', tile.x, tile.y);
            this.emit({ t: 'fx', kind: 'splash', x: tile.x + 0.5, y: tile.y + 0.5, n: 6 });
            this.cooldown = 0.5;
            return;
          }
          if (ps.water <= 0) {
            if (input.usePressed) this.toast('The can is empty. Fill it at the well, a rain barrel or the creek.', 'info');
            this.cooldown = 0.4;
            return;
          }
          this.startAction('pour', 'can', s.id, 0.42, 0.55, tile.x, tile.y, aim);
          this.cooldown = 0.45;
          return;
        }
        const t: Tool = s.id === 'hoe2' ? 'hoe' : (s.id as Tool);
        this.startAction('swing', t, s.id, t === 'hoe' ? 0.42 : 0.48, 0.6, tile.x, tile.y, aim);
        this.cooldown = t === 'hoe' ? 0.44 : 0.5;
        return;
      }
      case 'weapon': {
        if (s.id === 'pistol') {
          if (this.cooldown > 0) return;
          if (countItem(this.state.inv, 'rounds') <= 0) {
            if (input.usePressed) {
              this.sfx('click');
              this.toast('No rounds left.', 'bad');
            }
            this.cooldown = 0.4;
            return;
          }
          this.faceToward(aim.x, aim.y);
          this.startAction('shoot', 'pistol', s.id, 0.32, 0.1, tile.x, tile.y, aim);
          this.cooldown = def.cool ?? 0.55;
          return;
        }
        this.faceToward(aim.x, aim.y);
        this.startAction('swing', 'machete', s.id, 0.36, 0.45, tile.x, tile.y, aim);
        this.cooldown = def.cool ?? 0.42;
        return;
      }
      case 'seed':
        if (input.usePressed || this.cooldown <= 0) this.plant(tile.x, tile.y, s);
        this.cooldown = 0.18;
        return;
      case 'food':
      case 'medicine':
        if (!input.usePressed) return;
        this.consume(this.state.sel);
        return;
      case 'produce':
        return;
      case 'material':
        if (s.id === 'compost' && input.usePressed) this.applyCompost(tile.x, tile.y);
        return;
      case 'place':
        if (input.usePressed || this.cooldown <= 0) this.place(tile.x, tile.y, s);
        this.cooldown = 0.2;
        return;
      case 'ammo':
        return;
    }
    void p;
  }

  private resolveAction(a: Action): void {
    const ps = this.state.player;
    const w = this.world;
    const { tx, ty } = a;
    const line = (n: number): { x: number; y: number }[] => {
      const out = [{ x: tx, y: ty }];
      if (n <= 1) return out;
      // Continue away from the player along the main axis
      const dx = tx + 0.5 - this.player.x;
      const dy = ty + 0.5 - this.player.y;
      const sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) || 1 : 0;
      const sy = sx ? 0 : Math.sign(dy) || 1;
      for (let i = 1; i < n; i++) out.push({ x: tx + sx * i, y: ty + sy * i });
      return out;
    };
    if (a.tool === 'hoe' && a.item === 'hoe2') {
      this.spendStamina(3);
      for (const t of line(3)) this.tillOne(t.x, t.y, false);
      this.sfx('hoe', tx, ty);
      return;
    }
    if (a.tool === 'can' && a.item === 'can2') {
      this.spendStamina(1.5);
      this.emit({ t: 'fx', kind: 'water', x: tx + 0.5, y: ty + 0.5, n: 14 });
      this.sfx('water', tx, ty);
      for (const t of line(3)) {
        if (ps.water <= 0) break;
        if (this.waterOne(t.x, t.y)) ps.water = Math.max(0, ps.water - 1);
      }
      return;
    }
    switch (a.tool) {
      case 'hoe': {
        this.spendStamina(2);
        const o = w.objectAt(tx, ty);
        if (o && o.kind === 'weed') {
          this.damageObject(o, 9, 'hoe');
          return;
        }
        if (!this.tillable(tx, ty)) {
          this.sfx('thud', tx, ty, 0.5);
          return;
        }
        const k = idx(tx, ty);
        const crop = w.crops.get(k);
        if (crop && crop.dead) {
          w.crops.delete(k);
          this.emit({ t: 'fx', kind: 'soil', x: tx + 0.5, y: ty + 0.5, n: 6 });
          this.sfx('hoe', tx, ty);
          return;
        }
        if (w.tilled[k]) return;
        w.tilled[k] = 1;
        this.emit({ t: 'ground', x: tx, y: ty });
        this.emit({ t: 'fx', kind: 'soil', x: tx + 0.5, y: ty + 0.5, n: 8 });
        this.sfx('hoe', tx, ty);
        if (!this.state.flags.tilledOnce) {
          this.state.flags.tilledOnce = 1;
          this.toast('Turned soil. Plant seeds in it, then water it every day.', 'info');
        }
        return;
      }
      case 'can': {
        this.spendStamina(1);
        ps.water = Math.max(0, ps.water - 1);
        // Waters the target tile
        const k = idx(tx, ty);
        this.emit({ t: 'fx', kind: 'water', x: tx + 0.5, y: ty + 0.5, n: 10 });
        this.sfx('water', tx, ty);
        if (w.tilled[k] && !w.wet[k]) {
          w.wet[k] = 1;
          const c = w.crops.get(k);
          if (c) c.wet = true;
          this.emit({ t: 'ground', x: tx, y: ty });
        }
        return;
      }
      case 'axe':
      case 'pick': {
        this.spendStamina(3);
        const o = w.objectAt(tx, ty);
        if (!o) {
          this.sfx('swish', tx, ty, 0.6);
          return;
        }
        const d = OBJECTS[o.kind];
        if (d.tool === a.tool || d.tool === 'any') this.damageObject(o, 1, a.tool);
        else {
          this.sfx('clank', tx, ty, 0.7);
          this.emit({ t: 'fx', kind: 'spark', x: tx + 0.5, y: ty + 0.5, n: 3 });
          if (d.tool) this.toast(`That needs the ${d.tool === 'axe' ? 'axe' : 'pick'}.`, 'info');
        }
        return;
      }
      case 'machete': {
        const def = ITEMS.machete;
        this.spendStamina(def.stam ?? 3);
        this.sfx('swish');
        const hit = this.night.meleeHit(this.player.x, this.player.y, a.aimX, a.aimY, def.reach!, def.arc!, def.dmg!);
        if (!hit) {
          const o = w.objectAt(tx, ty);
          if (o && (o.kind === 'saltbush' || o.kind === 'weed')) this.damageObject(o, 9, 'axe');
        }
        return;
      }
      case 'pistol': {
        if (countItem(this.state.inv, 'rounds') <= 0) return;
        this.removeItemById('rounds', 1);
        const def = ITEMS.pistol;
        this.night.shoot(this.player.x, this.player.y, a.aimX, a.aimY, def.range!, def.dmg!);
        return;
      }
    }
  }

  canSize(): number {
    return this.selected()?.id === 'can2' ? 40 : 20;
  }

  /** Till one tile if possible. Returns true if it changed. */
  tillOne(x: number, y: number, sound = true): boolean {
    const w = this.world;
    const o = w.objectAt(x, y);
    if (o && o.kind === 'weed') {
      this.damageObject(o, 9, 'hoe');
      return true;
    }
    if (!this.tillable(x, y)) return false;
    const k = idx(x, y);
    const crop = w.crops.get(k);
    if (crop && crop.dead) {
      w.crops.delete(k);
      this.emit({ t: 'fx', kind: 'soil', x: x + 0.5, y: y + 0.5, n: 6 });
      return true;
    }
    if (w.tilled[k]) return false;
    w.tilled[k] = 1;
    this.emit({ t: 'ground', x, y });
    this.emit({ t: 'fx', kind: 'soil', x: x + 0.5, y: y + 0.5, n: 6 });
    if (sound) this.sfx('hoe', x, y);
    return true;
  }

  /** Water one tilled tile. Returns true if it was dry. */
  waterOne(x: number, y: number): boolean {
    const w = this.world;
    if (!inMap(x, y)) return false;
    const k = idx(x, y);
    if (!w.tilled[k] || w.wet[k]) return false;
    w.wet[k] = 1;
    const c = w.crops.get(k);
    if (c) c.wet = true;
    this.emit({ t: 'ground', x, y });
    return true;
  }

  removeItemById(id: string, n: number): void {
    for (let i = 0; i < this.state.inv.length && n > 0; i++) {
      const s = this.state.inv[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.n);
        removeFromSlot(this.state.inv, i, k);
        n -= k;
      }
    }
  }

  tillable(x: number, y: number): boolean {
    if (!inMap(x, y)) return false;
    const t = this.world.terrain[idx(x, y)];
    if (t === T.Road || t === T.Concrete || t === T.Water || t === T.Deep) return false;
    const o = this.world.objectAt(x, y);
    if (o && o.kind !== 'weed') return false;
    return true;
  }

  canRefillAt(x: number, y: number): boolean {
    const o = this.world.objectAt(x, y);
    if (o && o.kind === 'well') return true;
    if (o && o.kind === 'rain_barrel' && Number(o.s?.water ?? 0) > 0) return true;
    return this.world.isWater(x, y);
  }

  damageObject(o: WObject, dmg: number, tool: string): void {
    const d = OBJECTS[o.kind];
    const w = this.world;
    const cx = o.x + d.w / 2;
    const cy = o.y + d.h / 2;
    if (d.placed && (tool === 'axe' || tool === 'pick' || tool === 'hoe')) {
      // Pick up what you built
      w.remove(o);
      for (const [id] of d.drops ?? []) this.drop({ id, n: 1 }, cx, cy);
      this.sfx('pickup_obj', cx, cy);
      this.emit({ t: 'ground', x: o.x, y: o.y });
      return;
    }
    if (!d.hp) {
      this.sfx('clank', cx, cy, 0.6);
      return;
    }
    o.hp -= dmg;
    this.emit({ t: 'hit', id: o.id });
    const kind = o.kind.startsWith('tree') || o.kind === 'saltbush' ? 'chip' : o.kind === 'weed' ? 'leaf' : o.kind === 'scrap_pile' || o.kind === 'wreck' ? 'spark' : 'stone';
    this.emit({ t: 'fx', kind, x: cx, y: cy, z: 8, n: 6 });
    this.sfx(kind === 'chip' ? 'chop' : kind === 'leaf' ? 'rustle' : kind === 'spark' ? 'clank' : 'rock', cx, cy);
    this.emit({ t: 'shake', amt: 0.6 });
    if (o.hp <= 0) {
      w.remove(o);
      for (const [id, lo, hi] of d.drops ?? []) {
        const n = lo + Math.floor(this.rng() * (hi - lo + 1));
        if (n > 0) this.drop({ id, n }, cx, cy);
      }
      this.sfx(o.kind.startsWith('tree') ? 'fell' : 'break', cx, cy);
      this.emit({ t: 'fx', kind, x: cx, y: cy, z: 6, n: 14 });
      this.emit({ t: 'ground', x: o.x, y: o.y });
    }
  }

  // ------------------------------------------------------------------ farming

  plant(x: number, y: number, s: Stack): void {
    const w = this.world;
    const k = idx(x, y);
    const def = ITEMS[s.id];
    const crop = CROPS[def.crop!];
    if (!inMap(x, y) || !w.tilled[k] || w.crops.has(k) || w.objAt[k]) return;
    if (!crop.seasons.includes(this.season)) {
      this.toast(`${crop.name} will not grow in the ${this.season} season. It grows in ${crop.seasons.join(' and ')}.`, 'bad');
      this.cooldown = 0.6;
      return;
    }
    const c: Crop = { kind: crop.id, age: 0, wet: !!w.wet[k], dry: 0, ripe: false, regrowIn: 0, picked: false, care: 0, dead: false };
    w.crops.set(k, c);
    removeFromSlot(this.state.inv, this.state.sel, 1);
    this.sfx('plant', x, y);
    this.emit({ t: 'fx', kind: 'soil', x: x + 0.5, y: y + 0.5, n: 3 });
    if (this.world.contam[k] > 0.38 && !crop.hardy && !this.state.flags.taintHint) {
      this.state.flags.taintHint = 1;
      this.toast('This ground is bad. Crops grown here come out tainted. Sunflowers draw the poison out.', 'info');
    }
  }

  applyCompost(x: number, y: number): void {
    const k = idx(x, y);
    if (!inMap(x, y) || !this.world.tilled[k]) {
      this.toast('Spread compost on turned soil.', 'info');
      return;
    }
    if (this.world.fert[k] >= 0.98) {
      this.toast('This soil is as rich as it gets.', 'info');
      return;
    }
    this.world.fert[k] = Math.min(1, this.world.fert[k] + 0.3);
    removeFromSlot(this.state.inv, this.state.sel, 1);
    this.sfx('plant', x, y);
    this.emit({ t: 'fx', kind: 'soil', x: x + 0.5, y: y + 0.5, n: 8 });
    this.toast('The soil is richer here now.', 'good');
  }

  /** Quality from fertility and care. */
  qualityFor(k: number, c: Crop): number {
    const def = CROPS[c.kind];
    const careRatio = c.care / Math.max(1, def.days);
    const score = this.world.fert[k] * 0.6 + careRatio * 0.4 + (this.rng() - 0.5) * 0.15;
    return score > 0.78 ? 2 : score > 0.55 ? 1 : 0;
  }

  /** Picks the crop at a tile. Returns true if something was picked. `into` defaults to the player's bag. */
  harvestAt(x: number, y: number, into?: Stack[]): Stack[] | null {
    const w = this.world;
    const k = idx(x, y);
    const c = w.crops.get(k);
    if (!c || !c.ripe || c.dead) return null;
    const def = CROPS[c.kind];
    const n = def.yield[0] + Math.floor(this.rng() * (def.yield[1] - def.yield[0] + 1));
    const q = this.qualityFor(k, c);
    const tainted = w.contam[k] > 0.38 && !def.hardy;
    const out: Stack[] = [{ id: def.id, n, q, ...(tainted ? { t: 1 as const } : {}) }];
    // Sunflowers clean the soil around them
    if (def.cleans) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inMap(nx, ny)) continue;
          const kk = idx(nx, ny);
          w.contam[kk] = Math.max(0, w.contam[kk] - def.cleans * (dx || dy ? 0.6 : 1));
        }
      w.terrainVersion++;
      // Is the bad corner of the field clean yet?
      if (!this.state.flags.cleaned) {
        let worst = 0;
        for (let yy = 45; yy <= 50; yy++) for (let xx = 52; xx <= 57; xx++) worst = Math.max(worst, w.contam[idx(xx, yy)]);
        if (worst < 0.38) {
          this.state.flags.cleaned = 1;
          this.toast('The east corner of the field reads clean now. Whatever grows there will be sound.', 'good');
          this.state.journal.push({ day: this.state.day, text: 'Cleaned the bad ground in the east of the field.' });
        }
      }
    }
    if (def.regrow) {
      c.ripe = false;
      c.picked = true;
      c.regrowIn = def.regrow;
    } else {
      w.crops.delete(k);
      w.fert[k] = Math.max(0.1, w.fert[k] - 0.04);
    }
    this.state.stats.harvested += n;
    if (!into) {
      for (const s of out) {
        const left = addItem(this.state.inv, s);
        if (left) this.drop({ ...s, n: left }, x + 0.5, y + 0.5);
      }
    } else into.push(...out);
    this.emit({ t: 'ground', x, y });
    return out;
  }

  tryHarvest(x: number, y: number): boolean {
    const got = this.harvestAt(x, y);
    if (!got) return false;
    const s = got[0];
    this.faceToward(x + 0.5, y + 0.5);
    this.sfx('harvest', x, y);
    this.emit({ t: 'fx', kind: 'leaf', x: x + 0.5, y: y + 0.5, z: 6, n: 8 });
    const qn = ['', ' (Good)', ' (Prime)'][s.q ?? 0];
    this.emit({ t: 'float', text: `+${s.n} ${ITEMS[s.id].name}${qn}${s.t ? ' (tainted)' : ''}`, x: x + 0.5, y: y + 0.5, colour: s.t ? '#b8b860' : s.q === 2 ? '#f0d070' : '#e8e0c8' });
    if (!this.state.flags.firstHarvest) {
      this.state.flags.firstHarvest = 1;
      this.toast('Put produce in the depot crate. The Hull truck collects it on Tuesdays and Fridays.', 'info');
    }
    return true;
  }

  // ------------------------------------------------------------------ placing and eating

  place(x: number, y: number, s: Stack): void {
    const def = ITEMS[s.id];
    const kind = def.place!;
    const p = this.player;
    if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > REACH + 0.2) return;
    if (!this.world.canPlace(kind, x, y)) {
      this.sfx('deny');
      return;
    }
    // Not on top of yourself if it is solid
    if (OBJECTS[kind].solid && Math.floor(p.x) === x && Math.floor(p.y) === y) return;
    const o = this.world.add(kind, x, y, 0, kind === 'rain_barrel' ? { water: 0 } : kind === 'compost_bin' ? { load: 0, days: 0 } : undefined);
    void o;
    removeFromSlot(this.state.inv, this.state.sel, 1);
    this.sfx('place', x, y);
    this.emit({ t: 'fx', kind: 'dust', x: x + 0.5, y: y + 0.5, n: 6 });
    this.emit({ t: 'ground', x, y });
  }

  consume(slot: number): void {
    const s = this.state.inv[slot];
    if (!s) return;
    const def = ITEMS[s.id];
    const ps = this.state.player;
    let stamina = def.stamina ?? 0;
    let health = def.health ?? 0;
    if (def.kind === 'produce') {
      const crop = CROPS[def.crop!];
      stamina = crop.food * (1 + (s.q ?? 0) * 0.25);
      health = Math.round(crop.food / 4);
      if (s.t) this.addDose(8);
    }
    if (def.dose) ps.dose = Math.max(0, ps.dose + def.dose);
    const full = ps.stamina >= ps.maxStamina && ps.hp >= this.maxHp() && !def.dose;
    if (full) {
      this.toast('You are not hungry and not hurt.', 'info');
      return;
    }
    ps.stamina = Math.min(ps.maxStamina, ps.stamina + stamina);
    ps.hp = Math.min(this.maxHp(), ps.hp + health);
    removeFromSlot(this.state.inv, slot, 1);
    this.sfx(def.kind === 'medicine' ? 'bandage' : 'eat');
    const bits: string[] = [];
    if (stamina) bits.push(`+${Math.round(stamina)} energy`);
    if (health) bits.push(`+${health} health`);
    if (def.dose) bits.push(`${def.dose} dose`);
    this.emit({ t: 'float', text: bits.join('  '), x: this.player.x, y: this.player.y, colour: '#a0e080' });
  }

  // ------------------------------------------------------------------ interacting

  private interactTarget(input: InputFrame): { kind: string; x: number; y: number; id?: string; obj?: WObject } | null {
    const p = this.player;
    const tile = this.aimTile(input);
    const candidates: { x: number; y: number }[] = [tile, this.frontTile()];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) candidates.push({ x: Math.floor(p.x) + dx, y: Math.floor(p.y) + dy });
    // People first
    const person = this.personNear(input);
    if (person) return person;
    for (const c of candidates) {
      const k = idx(c.x, c.y);
      if (!inMap(c.x, c.y)) continue;
      const crop = this.world.crops.get(k);
      if (crop && crop.ripe && !crop.dead) return { kind: 'harvest', x: c.x, y: c.y };
      const o = this.world.objectAt(c.x, c.y);
      if (o) {
        const d = OBJECTS[o.kind];
        if (d.interact) return { kind: d.interact, x: c.x, y: c.y, obj: o };
      }
    }
    return null;
  }

  private personNear(input: InputFrame): { kind: string; x: number; y: number; id?: string } | null {
    const p = this.player;
    const near = (x: number, y: number) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < 1.6) return true;
      if (input.aim && Math.hypot(input.aim.x - x, input.aim.y - y) < 0.8 && d < 2.6) return true;
      return false;
    };
    const tr = this.trader.npcPos();
    if (tr && near(tr.x, tr.y)) return { kind: 'shop', x: tr.x, y: tr.y };
    const ap = this.hands.applicantPos();
    if (ap && near(ap.x, ap.y)) return { kind: 'hire', x: ap.x, y: ap.y, id: this.state.applicant!.id };
    for (const h of this.state.hands) if (near(h.x, h.y) && !this.hands.asleep(h)) return { kind: 'hand', x: h.x, y: h.y, id: h.id };
    return null;
  }

  private interact(input: InputFrame): void {
    const t = this.interactTarget(input);
    if (!t) {
      // Eat what is in hand, if it is food
      const s = this.selected();
      if (s && ITEMS[s.id].kind === 'produce') this.consume(this.state.sel);
      return;
    }
    switch (t.kind) {
      case 'harvest':
        this.tryHarvest(t.x, t.y);
        break;
      case 'sleep':
        this.emit({ t: 'open', what: 'sleep' });
        break;
      case 'water': {
        const ps = this.state.player;
        if (t.obj?.kind === 'rain_barrel' && Number(t.obj.s?.water ?? 0) <= 0) {
          this.toast('The barrel is dry. It fills when it rains.', 'info');
          break;
        }
        ps.water = this.canSize();
        this.sfx('refill', t.x, t.y);
        this.emit({ t: 'fx', kind: 'splash', x: t.x + 0.5, y: t.y + 0.5, n: 6 });
        this.toast('Can filled.', 'good');
        break;
      }
      case 'depot':
        this.emit({ t: 'open', what: 'depot' });
        break;
      case 'radio':
        this.emit({ t: 'open', what: 'radio' });
        break;
      case 'compost':
        this.useCompostBin(t.obj!);
        break;
      case 'shop':
        this.emit({ t: 'open', what: 'shop' });
        break;
      case 'hire':
        this.emit({ t: 'open', what: 'hire', id: t.id });
        break;
      case 'hand':
        this.emit({ t: 'open', what: 'hand', id: t.id });
        break;
    }
  }

  private useCompostBin(o: WObject): void {
    const s = (o.s ??= { load: 0, days: 0 });
    const load = Number(s.load ?? 0);
    if (s.ready) {
      const n = Math.max(1, Math.floor(load / 3));
      this.drop({ id: 'compost', n }, o.x + 0.5, o.y + 0.5);
      o.s = { load: 0, days: 0 };
      this.sfx('harvest', o.x, o.y);
      return;
    }
    // Put in fibre and crop waste from the selected slot
    const sel = this.selected();
    const okIds = ['fibre'];
    if (sel && (okIds.includes(sel.id) || (ITEMS[sel.id].kind === 'produce' && sel.t))) {
      const k = Math.min(sel.n, 30 - load);
      if (k <= 0) {
        this.toast('The bin is full. Give it two days.', 'info');
        return;
      }
      s.load = load + k;
      s.days = 0;
      removeFromSlot(this.state.inv, this.state.sel, k);
      this.sfx('rustle', o.x, o.y);
      this.toast(`Composting ${s.load}. Ready in two days.`, 'good');
      return;
    }
    this.toast(load ? `Composting ${load}. Ready in two days.` : 'Put fibre or tainted produce in here. It turns to compost in two days.', 'info');
  }

  // ------------------------------------------------------------------ pickups

  drop(item: Stack, x: number, y: number): void {
    const a = this.rng() * Math.PI * 2;
    const sp = 0.6 + this.rng() * 0.8;
    this.pickups.push({ id: this.nextPickup++, item: { ...item }, x, y, z: 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 26 + this.rng() * 14, age: 0 });
  }

  private updatePickups(): void {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const u = this.pickups[i];
      u.age += STEP;
      if (u.z > 0 || u.vz > 0) {
        u.vz -= 160 * STEP;
        u.z = Math.max(0, u.z + u.vz * STEP);
        u.x += u.vx * STEP;
        u.y += u.vy * STEP;
        if (u.z === 0 && u.vz < 0) {
          u.vz = Math.abs(u.vz) > 20 ? -u.vz * 0.35 : 0;
          u.vx *= 0.5;
          u.vy *= 0.5;
        }
      }
      if (u.age < 0.45 || this.dead) continue;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < 2.2) {
        // Pull toward the player
        const k = Math.min(1, (2.2 - d) * 4 * STEP + 0.04);
        u.x += (p.x - u.x) * k;
        u.y += (p.y - u.y) * k;
      }
      if (d < 0.45) {
        const left = addItem(this.state.inv, u.item);
        if (left < u.item.n) {
          this.sfx('pickup', u.x, u.y, 0.6);
          this.emit({ t: 'float', text: `+${u.item.n - left} ${ITEMS[u.item.id].name}`, x: p.x, y: p.y, colour: '#e8e0c8' });
        }
        if (left) {
          u.item.n = left;
          if (!this.state.flags.fullBag) {
            this.state.flags.fullBag = 1;
            this.toast('Your bag is full.', 'bad');
          }
        } else this.pickups.splice(i, 1);
      }
    }
  }

  /** On save, anything still on the ground goes into the bag (or is lost if the bag is full). */
  collectPickups(): void {
    for (const u of this.pickups) addItem(this.state.inv, u.item);
    this.pickups = [];
  }

  // ------------------------------------------------------------------ hurt

  hurtPlayer(dmg: number, fromX: number, fromY: number): void {
    if (this.invuln > 0 || this.dead) return;
    const ps = this.state.player;
    ps.hp -= dmg;
    this.invuln = 0.6;
    this.hurtT = 0.25;
    this.regenT = -10;
    const dx = this.player.x - fromX;
    const dy = this.player.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.knock = { x: (dx / len) * 5, y: (dy / len) * 5 };
    this.action = null;
    this.player.anim = 'hurt';
    this.player.animT = 0;
    this.sfx('hurt');
    this.emit({ t: 'shake', amt: 2.5 });
    this.emit({ t: 'hitstop', ms: 70 });
    this.emit({ t: 'fx', kind: 'blood', x: this.player.x, y: this.player.y, z: 12, n: 6 });
    if (ps.hp <= 0) {
      ps.hp = 0;
      this.dead = true;
      this.deadT = 0;
      this.sfx('down');
    }
  }

  // ------------------------------------------------------------------ cursor

  private updateTarget(input: InputFrame): void {
    const s = this.selected();
    const tile = this.aimTile(input);
    this.target = null;
    this.hint = '';
    const person = this.personNear(input);
    if (person) {
      this.hint = person.kind === 'shop' ? 'Trade' : person.kind === 'hire' ? 'Talk' : 'Talk';
    }
    if (!s) return;
    const def = ITEMS[s.id];
    const k = idx(tile.x, tile.y);
    if (!inMap(tile.x, tile.y)) return;
    const crop = this.world.crops.get(k);
    if (crop && crop.ripe && def.kind !== 'weapon') {
      this.target = { ...tile, ok: true, kind: 'harvest' };
      this.hint ||= 'Harvest';
      return;
    }
    const o = this.world.objectAt(tile.x, tile.y);
    if (o && OBJECTS[o.kind].interact && !this.hint) {
      const map: Record<string, string> = { sleep: 'Sleep', water: 'Fill can', depot: 'Open crate', radio: 'Listen', compost: 'Compost' };
      this.hint = map[OBJECTS[o.kind].interact!] ?? '';
    }
    switch (def.kind) {
      case 'tool':
        if (s.id === 'hoe' || s.id === 'hoe2') this.target = { ...tile, ok: this.tillable(tile.x, tile.y) && !this.world.tilled[k], kind: 'tool' };
        else if (s.id === 'can' || s.id === 'can2') this.target = { ...tile, ok: this.canRefillAt(tile.x, tile.y) || (!!this.world.tilled[k] && !this.world.wet[k]), kind: 'tool' };
        else {
          const d = o ? OBJECTS[o.kind] : null;
          this.target = { ...tile, ok: !!d && (d.tool === s.id || d.tool === 'any'), kind: 'tool' };
        }
        break;
      case 'seed':
        this.target = { ...tile, ok: !!this.world.tilled[k] && !crop && !o, kind: 'seed' };
        break;
      case 'place':
        this.target = { ...tile, ok: this.world.canPlace(def.place!, tile.x, tile.y), kind: 'place' };
        break;
      case 'material':
        if (s.id === 'compost') this.target = { ...tile, ok: !!this.world.tilled[k], kind: 'tool' };
        break;
    }
  }

  // ------------------------------------------------------------------ prices

  sellPrice(s: Stack): number {
    const base = baseSell(s.id);
    const q = QUALITY_MULT[s.q ?? 0];
    const t = s.t ? TAINT_MULT : 1;
    const d = this.state.trader.demand[s.id] ?? 1;
    return Math.max(1, Math.round(base * q * t * d));
  }
}
