// The Hull Provisioning truck: arrives on Tuesdays and Fridays, sells supplies, and collects the depot crate.
import { DAY_START, SEASONS, STEP } from '../core/config';
import { dirFromScreen, tileToScreenVec } from '../core/iso';
import { CROPS, ITEMS, TRADER } from '../data';
import { addItem, removeFromSlot } from './inventory';
import { Stack, dayOfSeason, seasonOf, weekdayIndex } from './state';
import { PLACES } from './worldgen';
import type { Sim } from './sim';

export const VISIT_DAYS = [1, 4]; // Tuesday and Friday
export const ARRIVE = 8 * 60;
export const LEAVE = 17 * 60;
const SPEED = 4.2;

export interface Truck {
  state: 'away' | 'in' | 'parked' | 'out';
  x: number;
  y: number;
  /** 0 = +x, 2 = -x (see the truck art). */
  dir: number;
  bounce: number;
}

export class TraderSystem {
  readonly truck: Truck = { state: 'away', x: PLACES.truckEnter.x, y: PLACES.truckEnter.y, dir: 2, bounce: 0 };
  private collectedDay = -1;

  constructor(private sim: Sim) {}

  visitToday(): boolean {
    return VISIT_DAYS.includes(weekdayIndex(this.sim.state.day));
  }

  /** Days until the next visit, 0 if today. */
  daysToVisit(): number {
    for (let d = 0; d < 7; d++) if (VISIT_DAYS.includes(weekdayIndex(this.sim.state.day + d))) return d;
    return 7;
  }

  update(): void {
    const s = this.sim;
    const m = s.state.minute;
    const t = this.truck;
    const stop = PLACES.truckStop;
    const enter = PLACES.truckEnter;
    t.bounce += STEP;
    if (!this.visitToday()) {
      t.state = 'away';
      return;
    }
    if (m < ARRIVE) {
      t.state = 'away';
      t.x = enter.x;
      return;
    }
    if (m < LEAVE) {
      if (t.state === 'away') {
        // If the game was loaded well after arrival time, the truck is already here
        t.state = m > ARRIVE + 30 ? 'parked' : 'in';
        t.x = t.state === 'parked' ? stop.x : enter.x;
        t.y = stop.y;
        t.dir = 2;
        if (t.state === 'in') s.sfx('truck_arrive', t.x, t.y);
      }
      if (t.state === 'in') {
        t.x -= SPEED * STEP;
        if (t.x <= stop.x) {
          t.x = stop.x;
          t.state = 'parked';
          s.sfx('truck_stop', t.x, t.y);
          const near = Math.hypot(s.player.x - stop.x, s.player.y - stop.y) < 30;
          if (near) s.toast(`The Hull truck has pulled in at the depot. ${TRADER.name} is selling until five.`, 'good');
        }
      }
      return;
    }
    // Leaving
    if (t.state === 'parked' || t.state === 'in') {
      this.collect();
      t.state = 'out';
      t.dir = 0;
      s.sfx('truck_leave', t.x, t.y);
    }
    if (t.state === 'out') {
      t.x += SPEED * STEP;
      if (t.x > enter.x) t.state = 'away';
    }
  }

  truckBox(): { x0: number; y0: number; x1: number; y1: number } | null {
    const t = this.truck;
    if (t.state === 'away') return null;
    return { x0: t.x - 1, y0: t.y - 0.45, x1: t.x + 1, y1: t.y + 0.45 };
  }

  /** Where the trader stands while the truck is parked. */
  npcPos(): { x: number; y: number; dir: number } | null {
    if (this.truck.state !== 'parked') return null;
    const x = PLACES.truckStop.x - 0.3;
    const y = PLACES.truckStop.y - 1.25;
    const p = this.sim.player;
    const v = tileToScreenVec(p.x - x, p.y - y);
    const dir = Math.hypot(p.x - x, p.y - y) < 5 ? dirFromScreen(v.x, v.y) : 6;
    return { x, y, dir };
  }

  /** Loads the depot crate onto the truck and pays for it. */
  collect(): number {
    const s = this.sim;
    if (this.collectedDay === s.state.day) return 0;
    this.collectedDay = s.state.day;
    let total = 0;
    let n = 0;
    for (const st of s.state.depot) {
      total += s.sellPrice(st) * st.n;
      n += st.n;
      this.lowerDemand(st.id, st.n);
    }
    s.state.depot = [];
    s.state.player.scrip += total;
    s.state.stats.earned += total;
    s.state.stats.shipped += n;
    s.state.trader.lastPaid += total;
    if (total > 0) {
      const near = Math.hypot(s.player.x - PLACES.crate.x, s.player.y - PLACES.crate.y) < 25;
      if (near) s.toast(`${TRADER.name} loaded the crate: ${n} items, ${total} scrip.`, 'good');
      s.sfx('coins');
    }
    return total;
  }

  lowerDemand(id: string, n: number): void {
    const d = this.sim.state.trader.demand;
    d[id] = Math.max(0.55, (d[id] ?? 1) * Math.pow(0.988, n));
  }

  /** What the truck carries today. */
  stock(): { id: string; price: number }[] {
    const s = this.sim;
    const season = seasonOf(s.state.day);
    const seasons = [season];
    if (dayOfSeason(s.state.day) >= 8) seasons.push(SEASONS[(SEASONS.indexOf(season) + 1) % 4]);
    const out: { id: string; price: number }[] = [];
    for (const c of Object.values(CROPS)) {
      if (!c.seasons.some(x => seasons.includes(x))) continue;
      const id = c.id + '_seed';
      out.push({ id, price: ITEMS[id].price! });
    }
    for (const id of ['rounds', 'bandage', 'tinned_beans', 'flatbread', 'iodide_tabs', 'cloth', 'wood', 'scrap']) out.push({ id, price: ITEMS[id].price! });
    out.push({ id: 'hen', price: ITEMS.hen.price! });
    for (const id of ['hoe2', 'can2']) if (!s.state.inv.some(x => x?.id === id)) out.push({ id, price: ITEMS[id].price! });
    return out;
  }

  buy(id: string, n: number): boolean {
    const s = this.sim;
    const price = ITEMS[id].price ?? 0;
    const cost = price * n;
    if (s.state.player.scrip < cost) {
      s.toast('Not enough scrip.', 'bad');
      s.sfx('deny');
      return false;
    }
    const left = addItem(s.state.inv, { id, n });
    const bought = n - left;
    if (!bought) {
      s.toast('Your bag is full.', 'bad');
      s.sfx('deny');
      return false;
    }
    s.state.player.scrip -= price * bought;
    s.sfx('coins');
    return true;
  }

  /** Sell from a bag slot straight to the trader. */
  sellSlot(slot: number, n: number): number {
    const s = this.sim;
    const st = s.state.inv[slot];
    if (!st) return 0;
    const def = ITEMS[st.id];
    if (def.kind === 'tool' || def.kind === 'weapon') return 0;
    const k = Math.min(n, st.n);
    const each = s.sellPrice(st);
    const total = each * k;
    this.lowerDemand(st.id, k);
    removeFromSlot(s.state.inv, slot, k);
    s.state.player.scrip += total;
    s.state.stats.earned += total;
    s.sfx('coins');
    return total;
  }

  /** Move a bag slot into the depot crate. */
  toDepot(slot: number, n: number): void {
    const s = this.sim;
    const st = s.state.inv[slot];
    if (!st) return;
    const def = ITEMS[st.id];
    if (def.kind === 'tool' || def.kind === 'weapon') return;
    const k = Math.min(n, st.n);
    const copy: Stack = { ...st, n: k };
    const same = s.state.depot.find(d => d.id === copy.id && (d.q ?? 0) === (copy.q ?? 0) && (d.t ?? 0) === (copy.t ?? 0));
    if (same) same.n += k;
    else s.state.depot.push(copy);
    removeFromSlot(s.state.inv, slot, k);
    s.sfx('drop_crate');
  }

  /** Take a stack back out of the crate. */
  fromDepot(i: number): void {
    const s = this.sim;
    const st = s.state.depot[i];
    if (!st) return;
    const left = addItem(s.state.inv, st);
    if (left) st.n = left;
    else s.state.depot.splice(i, 1);
  }

  depotValue(): number {
    return this.sim.state.depot.reduce((a, st) => a + this.sim.sellPrice(st) * st.n, 0);
  }

  /** At the start of a day, demand recovers. */
  newDay(): void {
    const d = this.sim.state.trader.demand;
    for (const k of Object.keys(d)) {
      d[k] += (1 - d[k]) * 0.3;
      if (Math.abs(1 - d[k]) < 0.01) delete d[k];
    }
    this.collectedDay = -1;
    this.truck.state = 'away';
    this.truck.x = PLACES.truckEnter.x;
    void DAY_START;
  }
}
