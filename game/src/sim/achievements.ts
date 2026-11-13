// Achievements: checked once a second. Unlocked ones are kept in settings-independent storage per profile
// (localStorage now; the desktop build will forward them to Steam once there is an app id).
import { ACHIEVEMENTS, DOCUMENTS } from '../data';
import type { Sim } from './sim';

const KEY = 'longtable.achievements';

export function unlockedAchievements(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export class Achievements {
  private got = unlockedAchievements();
  private t = 0;
  /** Called when something new unlocks. The desktop build can hook Steam in here. */
  onUnlock: ((id: string, name: string) => void) | null = null;

  constructor(private sim: Sim) {}

  private give(id: string): void {
    if (this.got.has(id)) return;
    this.got.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.got]));
    } catch {
      /* storage blocked */
    }
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) this.onUnlock?.(id, a.name);
  }

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const s = this.sim;
    const st = s.state;
    if (st.name === 'Title') return;
    const f = st.flags;
    if (f.tilledOnce) this.give('first_furrow');
    if (st.stats.harvested > 0) this.give('first_harvest');
    if (st.stats.earned > 0) this.give('first_sale');
    if (f.primeHarvest) this.give('prime');
    if (st.hands.length > 0) this.give('hired');
    if (f.fenceHeld) this.give('fence_held');
    if (f.cleaned) this.give('clean_ground');
    if (st.stats.husks >= 10) this.give('husks_10');
    if (st.crew.won > 0) this.give('crew_won');
    if (st.crew.paidUntil > 0) this.give('tithe');
    if (st.hens.length >= 4) this.give('full_coop');
    if (st.day > 12) this.give('season');
    if (Object.keys(DOCUMENTS).every(k => f['read:' + k])) this.give('papers');
    if (st.stats.earned >= 2000) this.give('scrip_2000');
  }
}
