// The DOM layer: HUD, toasts, floating text and every menu. Reads the sim; calls back into the game for actions.
import './ui.css';
import { h, clear } from './dom';
import { iconURL } from '../art/icons';
import { ACHIEVEMENTS, CREW, CROPS, DOCUMENTS, HANDS, ITEMS, QUALITY_NAMES, RECIPES, TRADER } from '../data';
import { unlockedAchievements } from '../sim/achievements';
import { MAP_H, MAP_W } from '../core/config';
import { T } from '../sim/world';
import { PLACES } from '../sim/worldgen';
import { addItem, countItem, removeItem } from '../sim/inventory';
import { HOTBAR, dayOfSeason, seasonOf, timeString, weekday, Stack } from '../sim/state';
import type { Sim } from '../sim/sim';
import type { SlotInfo } from '../sim/save';
import { ACTION_LABELS, Action, Input } from '../input/input';
import type { Audio } from '../audio/audio';
import { VISIT_DAYS } from '../sim/trader';
import { VERSION, WEEKDAYS } from '../core/config';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  gore: 'full' | 'reduced' | 'off';
  shake: boolean;
  zoomBias: number;
  textScale: number;
  seenNotice: boolean;
  keys: Partial<Record<Action, string[]>>;
}

export const DEFAULT_SETTINGS: Settings = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.7, gore: 'full', shake: true, zoomBias: 0, textScale: 1, seenNotice: false, keys: {} };

export type Difficulty = 'peaceful' | 'normal' | 'hard';

export interface GameApi {
  sim(): Sim | null;
  newGame(name: string, difficulty?: Difficulty): void;
  load(slot: number): void;
  save(): void;
  slots(): SlotInfo[];
  deleteSlot(slot: number): void;
  currentSlot(): number;
  settings: Settings;
  applySettings(): void;
  toTitle(): void;
  sleep(): void;
  worldToScreen(x: number, y: number, z?: number): { x: number; y: number };
  exportSave(): void;
  importSave(file: File): void;
}

/** Things to get done, in order. The first one not done shows on the HUD. */
export function goals(sim: Sim): [string, boolean][] {
  const st = sim.state;
  const fences = [...sim.world.objects.values()].filter(o => o.kind === 'fence' || o.kind === 'gate').length;
  return [
    ['Clear a patch of the field and turn the soil with the hoe', !!st.flags.tilledOnce],
    ['Plant seeds in turned soil, then water them', sim.world.crops.size > 0 || st.stats.harvested > 0],
    ['Bring in a first harvest', st.stats.harvested > 0],
    ['Sell something to the Hull: the depot crate or the truck', st.stats.earned > 0],
    ['Make a bunk (wood and cloth) and hire a hand', st.hands.length > 0],
    ['Fence in the field and leave a gate', fences >= 20],
    ['Clean the bad ground in the east of the field with sunflowers', st.flags.cleaned === 1],
    ['Earn 2,000 scrip in all', st.stats.earned >= 2000]
  ];
}

const WEATHER_LABEL: Record<string, string> = { clear: 'Clear', cloud: 'Overcast', rain: 'Rain', dust: 'Dust storm', frost: 'Frost' };

interface Float {
  el: HTMLElement;
  x: number;
  y: number;
  t: number;
}

export class UI {
  readonly root: HTMLElement;
  private hud: HTMLElement;
  private vitals!: HTMLElement;
  private clockEl!: HTMLElement;
  private hotbar!: HTMLElement;
  private itemName!: HTMLElement;
  private hintEl!: HTMLElement;
  private toasts!: HTMLElement;
  private objective!: HTMLElement;
  private goalT = 0;
  private floatsEl!: HTMLElement;
  private floats: Float[] = [];
  private screen: HTMLElement | null = null;
  screenName = '';
  private fadeEl: HTMLElement;
  private lastHud = '';
  private nameTimer = 0;
  private lastSel = -1;
  /** Bag selection for swapping. */
  private picked: number | null = null;
  private onClose: (() => void) | null = null;
  private rebinding: Action | null = null;

  constructor(private game: GameApi, private input: Input, private audio: Audio) {
    this.root = document.getElementById('ui')!;
    this.hud = h('div', { class: 'hud hidden' });
    this.buildHud();
    this.fadeEl = h('div', { class: 'fade' });
    this.root.append(this.hud, this.fadeEl);
  }

  get open(): boolean {
    return !!this.screen;
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    this.vitals = h('div', { class: 'panel vitals' });
    this.clockEl = h('div', { class: 'panel clock' });
    this.hotbar = h('div', { class: 'panel hotbar interactive' });
    this.itemName = h('div', { class: 'itemname' });
    this.hintEl = h('div', { class: 'panel hint' });
    this.toasts = h('div', { class: 'toasts' });
    this.objective = h('div', { class: 'panel objective' });
    this.floatsEl = h('div', { class: 'floats' });
    const left = h('div', { class: 'lefttop' }, this.vitals, this.objective, this.toasts);
    this.hud.append(h('div', { class: 'vignette' }), h('div', { class: 'hurtflash' }), this.floatsEl, left, this.clockEl, this.hintEl, this.itemName, this.hotbar);
    for (let i = 0; i < HOTBAR; i++) {
      const s = h('div', { class: 'slot', 'data-i': i });
      s.addEventListener('mousedown', e => {
        e.stopPropagation();
        const sim = this.game.sim();
        if (!sim) return;
        sim.state.sel = i;
        this.audio.play('ui_click');
      });
      this.hotbar.append(s);
    }
  }

  showHud(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
  }

  private bar(cls: string, label: string, v: number, max: number, cap = ''): string {
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    const low = cls !== 'dose' && pct < 25 ? ' low' : '';
    return `<div class="bar-row"><span>${label}</span><div class="bar ${cls}${low}"><i style="width:${pct}%"></i><span class="cap">${cap}</span></div></div>`;
  }

  slotHtml(s: Stack | null, extra = ''): string {
    if (!s) return '';
    const def = ITEMS[s.id];
    const q = s.q ? `<span class="q">${'*'.repeat(s.q)}</span>` : '';
    const t = s.t ? '<span class="t"></span>' : '';
    const n = s.n > 1 ? `<span class="n">${s.n}</span>` : '';
    return `<img src="${iconURL(s.id, !!s.t)}" alt="${def?.name ?? s.id}">${n}${q}${t}${extra}`;
  }

  updateHud(sim: Sim, dt: number): void {
    const st = sim.state;
    const ps = st.player;
    const maxHp = sim.maxHp();
    // Vitals
    let v = this.bar('hp', 'Health', ps.hp, maxHp, `${Math.ceil(ps.hp)}`) + this.bar('energy', 'Energy', ps.stamina, ps.maxStamina, `${Math.ceil(ps.stamina)}`);
    if (ps.dose > 0.5) v += this.bar('dose', 'Dose', ps.dose, 100, `${Math.round(ps.dose)}`);
    const sel = sim.selected();
    if (sel?.id === 'can') v += this.bar('water', 'Water', ps.water, 20, `${ps.water}`);
    if (ps.lantern) v += `<div class="faint" style="font-size:0.8em">Lantern lit</div>`;
    // Clock
    const season = seasonOf(st.day);
    const truckIn = sim.trader.daysToVisit();
    const truckText = truckIn === 0 ? (sim.trader.truck.state === 'parked' ? 'Hull truck at the depot' : st.minute < 17 * 60 ? 'Hull truck due at 08:00' : 'Hull truck has gone') : `Hull truck in ${truckIn} ${truckIn === 1 ? 'day' : 'days'}`;
    const c = `<div class="time">${timeString(st.minute)}</div><div class="date">${weekday(st.day)} ${dayOfSeason(st.day)}, ${season} season</div><div class="wx">${WEATHER_LABEL[st.weather]}</div><div class="scrip">${ps.scrip}</div><div class="truck">${truckText}</div>`;
    const key = v + c;
    if (key !== this.lastHud) {
      this.lastHud = key;
      this.vitals.innerHTML = v;
      this.clockEl.innerHTML = c;
    }
    this.hud.classList.toggle('lowhp', ps.hp < maxHp * 0.3);
    // The next thing to do
    this.goalT -= dt;
    if (this.goalT <= 0) {
      this.goalT = 1;
      const next = goals(sim).find(g => !g[1]);
      const text = next ? next[0] : '';
      if (this.objective.dataset.t !== text) {
        this.objective.dataset.t = text;
        this.objective.innerHTML = text ? `<span class="faint">Next</span> ${text}` : '';
        this.objective.style.display = text ? '' : 'none';
      }
    }
    // Hotbar
    for (let i = 0; i < HOTBAR; i++) {
      const el = this.hotbar.children[i] as HTMLElement;
      const s = st.inv[i];
      const meter = s?.id === 'can' ? `<span class="meter"><i style="width:${(ps.water / 20) * 100}%"></i></span>` : '';
      const html = `<span class="k">${(i + 1) % 10}</span>` + this.slotHtml(s, meter);
      if (el.dataset.h !== html) {
        el.dataset.h = html;
        el.innerHTML = html;
      }
      el.classList.toggle('sel', i === st.sel);
    }
    // Item name flashes when the selection changes
    if (st.sel !== this.lastSel) {
      this.lastSel = st.sel;
      this.nameTimer = 1.6;
      const s = st.inv[st.sel];
      this.itemName.textContent = s ? this.itemLabel(s) : '';
    }
    this.nameTimer -= dt;
    this.itemName.style.opacity = this.nameTimer > 0 ? '1' : '0';
    // Interaction hint
    const pad = this.input.device === 'pad';
    if (sim.hint && !sim.dead) {
      const k = pad ? 'X' : 'E';
      const html = `<span class="key">${k}</span>${sim.hint}`;
      if (this.hintEl.dataset.h !== html) {
        this.hintEl.dataset.h = html;
        this.hintEl.innerHTML = html;
      }
      this.hintEl.style.display = '';
    } else this.hintEl.style.display = 'none';
    // Floating text follows the world
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      const p = this.game.worldToScreen(f.x, f.y, 26 + f.t * 18);
      f.el.style.left = `${p.x}px`;
      f.el.style.top = `${p.y}px`;
      f.el.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.9) / 0.6));
      if (f.t > 1.5) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }
  }

  itemLabel(s: Stack): string {
    const def = ITEMS[s.id];
    let n = def.name;
    if (def.kind === 'produce') n = `${QUALITY_NAMES[s.q ?? 0]} ${n}${s.t ? ', tainted' : ''}`;
    return n;
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const el = h('div', { class: `panel toast ${kind}` }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => el.classList.add('out'), 4800);
    setTimeout(() => el.remove(), 5400);
  }

  float(text: string, x: number, y: number, colour = '#e8e0c8'): void {
    const el = h('div', { class: 'float', style: { color: colour } }, text);
    this.floatsEl.append(el);
    this.floats.push({ el, x, y, t: 0 });
    if (this.floats.length > 24) {
      this.floats[0].el.remove();
      this.floats.shift();
    }
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }

  // ------------------------------------------------------------------ screens

  close(): void {
    if (!this.screen) return;
    this.screen.remove();
    this.screen = null;
    this.screenName = '';
    this.picked = null;
    this.rebinding = null;
    this.input.onAnyKey = null;
    this.audio.play('ui_close');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private show(name: string, content: HTMLElement, opts: { clear?: boolean; onClose?: () => void; sound?: boolean } = {}): void {
    if (this.screen) {
      this.screen.remove();
      this.screen = null;
    }
    this.screenName = name;
    const scr = h('div', { class: `screen${opts.clear ? ' clear' : ''}` }, content);
    scr.addEventListener('mousedown', e => {
      if (e.target === scr && !['title', 'notice', 'intro', 'report', 'newgame'].includes(name)) this.close();
    });
    this.root.append(scr);
    this.screen = scr;
    this.onClose = opts.onClose ?? null;
    if (opts.sound !== false) this.audio.play('ui_open');
    // Focus the first button for controller and keyboard users
    const first = scr.querySelector('button.primary, button') as HTMLButtonElement | null;
    first?.focus({ preventScroll: true });
  }

  /** Controller and keyboard navigation inside menus. */
  navigate(): void {
    if (!this.screen) return;
    const btns = Array.from(this.screen.querySelectorAll('button:not(:disabled), .slot, input')) as HTMLElement[];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement as HTMLElement);
    const go = (d: number) => {
      const n = btns[(Math.max(0, i) + d + btns.length) % btns.length];
      if (!n.hasAttribute('tabindex') && n.classList.contains('slot')) n.setAttribute('tabindex', '0');
      n.focus({ preventScroll: false });
    };
    if (this.input.padButton('DOWN') || this.input.padButton('RIGHT')) go(1);
    if (this.input.padButton('UP') || this.input.padButton('LEFT')) go(-1);
    if (this.input.padButton('A') && i >= 0) btns[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    if (this.input.padButton('B') && !['title', 'notice', 'intro', 'report'].includes(this.screenName)) this.close();
  }

  // ---- title and starting

  showLoading(text: string): HTMLElement {
    const el = h('div', { class: 'loading' }, text);
    this.root.append(el);
    return el;
  }

  showNotice(then: () => void): void {
    const s = this.game.settings;
    const goreBtn = h('button', { onclick: () => {
      s.gore = s.gore === 'full' ? 'reduced' : s.gore === 'reduced' ? 'off' : 'full';
      goreBtn.textContent = `Gore: ${s.gore === 'full' ? 'Full' : s.gore === 'reduced' ? 'Reduced' : 'Off'}`;
      this.game.applySettings();
    } }, `Gore: ${s.gore === 'full' ? 'Full' : s.gore === 'reduced' ? 'Reduced' : 'Off'}`);
    const panel = h('div', { class: 'panel modal', style: { maxWidth: 'calc(var(--u) * 34)', textAlign: 'center' } },
      h('h2', null, 'For adults'),
      h('p', null, 'This game is for players 18 and over.'),
      h('p', { class: 'dim' }, 'It has violence and blood, death, hunger, hard choices about other people, and the end of the world. It has no sexual content.'),
      h('p', { class: 'dim' }, 'You can turn the gore down or off now, or any time in Settings.'),
      h('div', { class: 'col', style: { marginTop: 'calc(var(--u) * 1)' } }, goreBtn, h('button', { class: 'primary', onclick: () => {
        s.seenNotice = true;
        this.game.applySettings();
        this.close();
        then();
      } }, 'I am 18 or over. Continue'))
    );
    this.show('notice', panel);
  }

  showTitle(): void {
    this.showHud(false);
    const slots = this.game.slots();
    const latest = slots.sort((a, b) => b.savedAt - a.savedAt)[0];
    const menu = h('div', { class: 'menu' },
      latest ? h('button', { class: 'primary', onclick: () => { this.close(); this.game.load(latest.slot); } }, `Continue: ${latest.name}, day ${latest.day}`) : null,
      h('button', { class: latest ? '' : 'primary', onclick: () => this.showNewGame() }, 'New game'),
      slots.length ? h('button', { onclick: () => this.showLoad() }, 'Load') : null,
      h('button', { onclick: () => this.showSettings(() => this.showTitle()) }, 'Settings'),
      h('button', { onclick: () => this.showAchievements() }, 'Achievements'),
      h('button', { onclick: () => this.showCredits() }, 'About')
    );
    const panel = h('div', { class: 'col', style: { alignItems: 'center' } },
      h('div', { class: 'logo' }, 'LONG TABLE'),
      h('div', { class: 'sub' }, 'Grow enough, and they can come home.'),
      menu
    );
    const scr = h('div', { class: 'title', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' } }, panel, h('div', { class: 'ver' }, `Playtest build ${VERSION}`));
    this.show('title', scr, { sound: false });
  }

  private showAchievements(): void {
    const got = unlockedAchievements();
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 32)' } },
      h('div', { class: 'row spread' }, h('h2', null, 'Achievements'), h('span', { class: 'faint' }, `${got.size} of ${ACHIEVEMENTS.length}`)),
      h('div', { class: 'list' }, ACHIEVEMENTS.map(a => h('div', { class: `line${got.has(a.id) ? '' : ' off'}`, style: { gridTemplateColumns: '1fr auto' } },
        h('div', null, h('div', { class: got.has(a.id) ? 'good' : '' }, a.name), h('div', { class: 'faint', style: { fontSize: '0.85em' } }, a.desc)),
        h('span', { class: got.has(a.id) ? 'good' : 'faint' }, got.has(a.id) ? 'Done' : '')))),
      h('button', { class: 'primary', style: { marginTop: 'calc(var(--u) * 0.6)' }, onclick: () => this.showTitle() }, 'Back')
    );
    this.show('credits', panel);
  }

  private showCredits(): void {
    const panel = h('div', { class: 'panel modal', style: { maxWidth: 'calc(var(--u) * 36)' } },
      h('h2', null, 'About'),
      h('p', null, 'Long Table is a working title. This is an early playtest build.'),
      h('p', { class: 'dim' }, 'Design and direction: Broden Johnson. Built with Claude.'),
      h('p', { class: 'dim' }, 'Every picture and sound in the game is drawn or synthesised by the game\'s own code. Font: Pixelify Sans, SIL Open Font Licence.'),
      h('button', { onclick: () => this.showTitle() }, 'Back')
    );
    this.show('credits', panel);
  }

  private showNewGame(): void {
    const name = h('input', { type: 'text', maxlength: 20, value: 'Unit Eleven', placeholder: 'Name' }) as HTMLInputElement;
    let diff: Difficulty = 'normal';
    const diffText: Record<Difficulty, string> = {
      peaceful: 'Peaceful: no Husks. Farming, trade and hands only.',
      normal: 'Normal: Husks come at night, more as the farm grows.',
      hard: 'Hard: half as many again, and they hit harder on your crops.'
    };
    const diffNote = h('p', { class: 'faint' }, diffText[diff]);
    const diffBtn = h('button', null, 'Normal');
    diffBtn.addEventListener('click', () => {
      diff = diff === 'normal' ? 'hard' : diff === 'hard' ? 'peaceful' : 'normal';
      diffBtn.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
      diffNote.textContent = diffText[diff];
    });
    const start = () => {
      const n = name.value.trim() || 'Unit Eleven';
      this.close();
      this.game.newGame(n, diff);
    };
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter') start();
    });
    const slots = this.game.slots();
    const warn = slots.length >= 3 ? h('p', { class: 'warn' }, 'All three save slots are full. A new game will replace the oldest.') : null;
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 26)' } },
      h('h2', null, 'New game'),
      h('p', { class: 'dim' }, 'The name on your tag.'),
      name,
      h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.6)' } }, h('span', { class: 'dim' }, 'Nights'), diffBtn),
      diffNote,
      warn,
      h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.8)' } }, h('button', { class: 'primary', onclick: start }, 'Begin'), h('button', { onclick: () => this.showTitle() }, 'Back'))
    );
    this.show('newgame', panel);
    setTimeout(() => name.select(), 30);
  }

  private showLoad(): void {
    const slots = this.game.slots().sort((a, b) => a.slot - b.slot);
    const list = h('div', { class: 'list' });
    for (const s of slots) {
      const when = new Date(s.savedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
      list.append(h('div', { class: 'line', style: { gridTemplateColumns: '1fr auto auto' } },
        h('div', null, h('div', null, `${s.name}, day ${s.day}`), h('div', { class: 'faint' }, `${s.scrip} scrip. Saved ${when}`)),
        h('button', { class: 'primary', onclick: () => { this.close(); this.game.load(s.slot); } }, 'Load'),
        h('button', { class: 'small', onclick: () => { if (confirm(`Delete ${s.name}? This cannot be undone.`)) { this.game.deleteSlot(s.slot); this.showLoad(); } } }, 'Delete')
      ));
    }
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } }) as HTMLInputElement;
    file.addEventListener('change', () => {
      if (file.files?.[0]) this.game.importSave(file.files[0]);
    });
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 32)' } },
      h('h2', null, 'Load'),
      slots.length ? list : h('p', { class: 'dim' }, 'No saves yet.'),
      h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.8)' } }, h('button', { onclick: () => file.click() }, 'Import a save file'), file, h('button', { onclick: () => this.showTitle() }, 'Back'))
    );
    this.show('load', panel);
  }

  showIntro(then: () => void): void {
    const panel = h('div', { class: 'note' },
      h('p', null, 'If you are reading this, it worked.'),
      h('p', null, 'You will not remember writing it. That was the point. Do not go looking for the reason yet.'),
      h('p', null, 'The house is sound. The well is clean. The field is not, all of it, so watch the east corner. Plant what will grow. Keep it alive. Sell what you can to the Hull truck.'),
      h('p', null, 'Things walk at night. They follow light. Do not leave lamps burning for no reason.'),
      h('p', null, 'The seeds matter more than you do.'),
      h('p', { class: 'sign' }, 'You'),
      h('button', { class: 'primary', onclick: () => { this.close(); then(); } }, 'Fold the note away')
    );
    this.show('intro', panel);
  }

  showReport(sim: Sim, then: () => void): void {
    const st = sim.state;
    const items = st.report.length ? st.report : ['A quiet night.'];
    const panel = h('div', { class: 'panel modal report', style: { width: 'calc(var(--u) * 30)' } },
      h('div', { class: 'day' }, `${weekday(st.day)}, day ${dayOfSeason(st.day)} of the ${seasonOf(st.day)} season`),
      h('div', { class: 'dim' }, `Weather: ${WEATHER_LABEL[st.weather]}. Tomorrow looks like ${WEATHER_LABEL[st.tomorrow].toLowerCase()}.`),
      h('ul', null, items.map(t => h('li', null, t))),
      h('button', { class: 'primary', onclick: () => { this.close(); then(); } }, 'Start the day')
    );
    this.show('report', panel, { sound: false });
  }

  // ---- in-game menus

  showPause(): void {
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 20)' } },
      h('h2', null, 'Paused'),
      h('div', { class: 'col' },
        h('button', { class: 'primary', onclick: () => this.close() }, 'Resume'),
        h('button', { onclick: () => { this.game.save(); this.toast('Saved.', 'good'); this.close(); } }, 'Save'),
        h('button', { onclick: () => this.showJournal() }, 'Journal'),
        h('button', { onclick: () => this.showSettings(() => this.showPause()) }, 'Settings'),
        h('button', { onclick: () => this.showControls(() => this.showPause()) }, 'Controls'),
        h('button', { onclick: () => this.game.exportSave() }, 'Export this save'),
        h('button', { onclick: () => { this.close(); this.game.toTitle(); } }, 'Save and quit to title')
      )
    );
    this.show('pause', panel);
  }

  showSettings(back: () => void): void {
    const s = this.game.settings;
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'ambience') => {
      const inp = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s[key] * 100) }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        s[key] = Number(inp.value) / 100;
        this.game.applySettings();
      });
      return h('div', null, h('div', { class: 'dim' }, label), inp);
    };
    const cycle = (label: string, get: () => string, next: () => void) => {
      const b = h('button', null, `${label}: ${get()}`);
      b.addEventListener('click', () => {
        next();
        this.game.applySettings();
        b.textContent = `${label}: ${get()}`;
      });
      return b;
    };
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 26)' } },
      h('h2', null, 'Settings'),
      h('div', { class: 'col' },
        slider('Master volume', 'master'),
        slider('Music', 'music'),
        slider('Sound effects', 'sfx'),
        slider('Ambience', 'ambience'),
        cycle('Gore', () => (s.gore === 'full' ? 'Full' : s.gore === 'reduced' ? 'Reduced' : 'Off'), () => (s.gore = s.gore === 'full' ? 'reduced' : s.gore === 'reduced' ? 'off' : 'full')),
        cycle('Screen shake', () => (s.shake ? 'On' : 'Off'), () => (s.shake = !s.shake)),
        cycle('Zoom', () => (s.zoomBias === 0 ? 'Normal' : s.zoomBias > 0 ? `Closer ${s.zoomBias}` : `Further ${-s.zoomBias}`), () => (s.zoomBias = s.zoomBias >= 2 ? -1 : s.zoomBias + 1)),
        cycle('Text size', () => (s.textScale >= 1.2 ? 'Large' : s.textScale <= 0.9 ? 'Small' : 'Normal'), () => (s.textScale = s.textScale >= 1.2 ? 0.88 : s.textScale <= 0.9 ? 1 : 1.25)),
        h('button', { onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); } }, 'Fullscreen on or off'),
        h('button', { onclick: () => this.showControls(() => this.showSettings(back)) }, 'Controls'),
        h('button', { class: 'primary', onclick: back }, 'Back')
      )
    );
    this.show('settings', panel);
  }

  showControls(back: () => void): void {
    const list = h('div', { class: 'keylist' });
    const actions = Object.keys(ACTION_LABELS) as Action[];
    const render = () => {
      clear(list);
      for (const a of actions) {
        const keys = this.input.keys[a].map(k => k.replace('Key', '').replace('Digit', '').replace('Arrow', ''));
        const b = h('button', { class: 'small' }, this.rebinding === a ? 'Press a key' : keys.join(' / ') || 'None');
        b.addEventListener('click', () => {
          this.rebinding = a;
          render();
          this.input.onAnyKey = code => {
            if (code === 'Escape') {
              this.rebinding = null;
              this.input.onAnyKey = null;
              render();
              return true;
            }
            this.game.settings.keys[a] = [code];
            this.input.keys[a] = [code];
            this.rebinding = null;
            this.input.onAnyKey = null;
            this.game.applySettings();
            render();
            return true;
          };
        });
        list.append(h('div', null, ACTION_LABELS[a]), b);
      }
    };
    render();
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 30)' } },
      h('h2', null, 'Controls'),
      h('p', { class: 'dim' }, 'Left mouse: use the item in your hand (tools, seeds, weapons, food). Right mouse or E: interact, harvest, talk. Mouse wheel or 1 to 0: choose an item.'),
      h('p', { class: 'dim' }, 'Controller: left stick moves, right stick aims, A uses, X interacts, B rolls, Y opens the bag, LB and RB choose items, D-pad up lights the lantern, Start pauses.'),
      list,
      h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.8)' } },
        h('button', { onclick: () => { this.game.settings.keys = {}; this.input.setKeys({}); this.game.applySettings(); render(); } }, 'Reset keys'),
        h('button', { class: 'primary', onclick: back }, 'Back'))
    );
    this.show('controls', panel);
  }

  showSleep(): void {
    const sim = this.game.sim()!;
    const h24 = (sim.state.minute / 60) % 24;
    const early = h24 >= 6 && h24 < 18;
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 24)', textAlign: 'center' } },
      h('h2', null, 'Go to bed?'),
      h('p', { class: 'dim' }, early ? 'It is still light. The day ends when you sleep, and your crops will not wait.' : 'The day ends and the game saves.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'primary', onclick: () => { this.close(); this.game.sleep(); } }, 'Sleep'),
        h('button', { onclick: () => this.close() }, 'Not yet'))
    );
    this.show('sleep', panel);
  }

  showRadio(sim: Sim): void {
    const st = sim.state;
    const forecast: Record<string, string> = {
      clear: 'clear skies and a hard sun',
      cloud: 'cloud cover, no rain in it',
      rain: 'rain, a good soaking by the look of it',
      dust: 'dust coming off the flats. Cover your mouth',
      frost: 'a frost overnight. Tender crops will stop growing'
    };
    const night = sim.isNight();
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 30)' } },
      h('h2', null, 'The radio'),
      h('p', null, `"...Hull weather, for the valleys west of the marsh. Tomorrow, ${forecast[st.tomorrow]}. Truck runs Tuesday and Friday as usual. Lock your gates."`),
      night ? h('p', { class: 'quote' }, 'Under the static, on a band nobody uses, a slow voice reads numbers. Then a call sign you almost recognise.') : null,
      h('button', { class: 'primary', onclick: () => this.close() }, 'Switch it off')
    );
    this.show('radio', panel);
  }

  // ---- bag and making things

  showBag(tab: 'bag' | 'make' = 'bag'): void {
    const sim = this.game.sim()!;
    const st = sim.state;
    const body = h('div');
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: tab === 'bag' ? 'on' : '', onclick: () => this.showBag('bag') }, 'Bag'),
      h('button', { class: tab === 'make' ? 'on' : '', onclick: () => this.showBag('make') }, 'Make'));
    const panel = h('div', { class: 'panel modal' }, tabs, body);
    if (tab === 'bag') {
      const grid = h('div', { class: 'grid' });
      const detail = h('div', { class: 'detail' });
      const renderDetail = (i: number | null) => {
        clear(detail);
        const s = i === null ? null : st.inv[i];
        if (!s) {
          detail.append(h('div', { class: 'faint' }, 'Click an item to see it. Click another slot to swap them. The top row is your hotbar.'));
          return;
        }
        const def = ITEMS[s.id];
        detail.append(h('div', null, h('b', null, this.itemLabel(s)), s.n > 1 ? h('span', { class: 'faint' }, `  x${s.n}`) : null));
        if (def.desc) detail.append(h('div', { class: 'dim' }, def.desc));
        if (def.kind === 'animal') detail.append(h('div', { class: 'dim' }, 'Hold her on your hotbar and click open ground near a coop to let her out.'));
        if (def.kind === 'seed') {
          const c = CROPS[def.crop!];
          detail.append(h('div', { class: 'dim' }, `Grows in ${c.seasons.join(' and ')}. ${c.days} days to ripen${c.regrow ? `, then again every ${c.regrow} days` : ''}. Sells for about ${c.sell}.`));
        }
        if (def.kind === 'produce') {
          detail.append(h('div', { class: 'price' }, `Sells for about ${sim.sellPrice(s)} each.`));
          if (s.t) detail.append(h('div', { class: 'warn' }, 'Tainted. Eating it raises your dose. Worth less, but the Hull still buys it.'));
        }
        const btns = h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.4)' } });
        if (def.kind === 'food' || def.kind === 'medicine' || def.kind === 'produce') btns.append(h('button', { class: 'small', onclick: () => { sim.consume(i!); this.showBag('bag'); } }, def.kind === 'medicine' ? 'Use' : 'Eat'));
        if (def.kind !== 'tool' && def.kind !== 'weapon') btns.append(h('button', { class: 'small', onclick: () => { if (confirm(`Throw away ${s.n} ${def.name}?`)) { st.inv[i!] = null; this.showBag('bag'); } } }, 'Throw away'));
        detail.append(btns);
      };
      st.inv.forEach((s, i) => {
        const el = h('div', { class: `slot${i === st.sel ? ' sel' : ''}${this.picked === i ? ' pick' : ''}`, tabindex: 0, html: this.slotHtml(s) });
        el.addEventListener('click', () => {
          this.audio.play('ui_click');
          if (this.picked === null) {
            if (!st.inv[i]) return;
            this.picked = i;
            renderDetail(i);
            this.showBag('bag');
            renderDetail(i);
          } else {
            const a = this.picked;
            [st.inv[a], st.inv[i]] = [st.inv[i], st.inv[a]];
            this.picked = null;
            this.showBag('bag');
          }
        });
        el.addEventListener('mouseenter', () => { if (this.picked === null) renderDetail(i); });
        if (i === HOTBAR) grid.append(h('div', { style: { gridColumn: '1 / -1', height: 'calc(var(--u) * 0.3)' } }));
        grid.append(el);
      });
      renderDetail(this.picked);
      const ps = st.player;
      body.append(grid, h('div', { class: 'sep' }), detail,
        h('div', { class: 'row spread faint', style: { marginTop: 'calc(var(--u) * 0.5)' } },
          h('span', null, `Scrip ${ps.scrip}`), h('span', null, `Rounds ${countItem(st.inv, 'rounds')}`), h('span', null, `Dose ${Math.round(ps.dose)}`)));
    } else {
      const list = h('div', { class: 'list' });
      const fire = sim.nearFire();
      const sorted = [...RECIPES].sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0));
      let shownFireHeader = false;
      for (const r of sorted) {
        const out = ITEMS[r.out];
        if (r.at === 'fire' && !shownFireHeader) {
          shownFireHeader = true;
          list.append(h('h3', null, fire ? 'Cooking at the fire' : 'Cooking (stand by the campfire)'));
        }
        const can = Object.entries(r.in).every(([k, n]) => countItem(st.inv, k) >= n) && (r.at !== 'fire' || fire);
        const need = Object.entries(r.in).map(([k, n]) => {
          const have = countItem(st.inv, k);
          return h('span', { class: have >= n ? '' : 'bad' }, `${ITEMS[k].name} ${have}/${n}  `);
        });
        const make = (times: number) => {
          let made = 0;
          for (let t = 0; t < times; t++) {
            if (!Object.entries(r.in).every(([k, n]) => countItem(st.inv, k) >= n)) break;
            if (r.at === 'fire' && !sim.nearFire()) break;
            for (const [k, n] of Object.entries(r.in)) removeItem(st.inv, k, n);
            const left = addItem(st.inv, { id: r.out, n: r.n });
            if (left) sim.drop({ id: r.out, n: left }, sim.player.x, sim.player.y);
            made++;
          }
          if (made) {
            this.audio.play(r.at === 'fire' ? 'eat' : 'place');
            this.toast(`Made ${made * r.n} ${out.name}.`, 'good');
          }
          this.showBag('make');
        };
        list.append(h('div', { class: `line${can ? '' : ' off'}` },
          h('img', { src: iconURL(r.out) }),
          h('div', null, h('div', null, `${out.name}${r.n > 1 ? ` x${r.n}` : ''}`), h('div', { class: 'faint', style: { fontSize: '0.85em' } }, need), out.desc ? h('div', { class: 'dim', style: { fontSize: '0.8em' } }, out.desc) : null),
          h('div', { class: 'row' }, h('button', { class: 'small', disabled: !can, onclick: () => make(1) }, 'Make'), h('button', { class: 'small', disabled: !can, onclick: () => make(5) }, 'x5'))
        ));
      }
      body.append(h('p', { class: 'dim' }, 'Things you make go in your bag. Pick a placeable item on your hotbar and click the ground to put it down. Hit it with the axe or pick to take it back.'), list);
    }
    this.show('bag', panel, { sound: this.screenName !== 'bag' });
  }

  // ---- depot crate

  showDepot(): void {
    const sim = this.game.sim()!;
    const st = sim.state;
    const bag = h('div', { class: 'grid' });
    st.inv.forEach((s, i) => {
      const def = s ? ITEMS[s.id] : null;
      const ok = !!def && def.kind !== 'tool' && def.kind !== 'weapon';
      const el = h('div', { class: `slot${ok ? '' : ' empty'}`, tabindex: 0, html: this.slotHtml(s), title: s ? `${this.itemLabel(s)}: ${sim.sellPrice(s)} each` : '' });
      if (ok)
        el.addEventListener('click', e => {
          sim.trader.toDepot(i, (e as MouseEvent).shiftKey ? 1 : s!.n);
          this.showDepot();
        });
      if (!ok && s) el.style.opacity = '0.35';
      bag.append(el);
    });
    const crate = h('div', { class: 'grid crate' });
    st.depot.forEach((s, i) => {
      const el = h('div', { class: 'slot', tabindex: 0, html: this.slotHtml(s), title: `${this.itemLabel(s)}: ${sim.sellPrice(s)} each` });
      el.addEventListener('click', () => {
        sim.trader.fromDepot(i);
        this.audio.play('ui_click');
        this.showDepot();
      });
      crate.append(el);
    });
    for (let i = st.depot.length; i < 12; i++) crate.append(h('div', { class: 'slot empty' }));
    const days = sim.trader.daysToVisit();
    const next = days === 0 ? (st.minute < 17 * 60 ? 'today, before five' : 'on the next run') : `on ${WEEKDAYS[(st.day - 1 + days) % 7]}`;
    const panel = h('div', { class: 'panel modal' },
      h('h2', null, 'Depot crate'),
      h('p', { class: 'dim' }, `The Hull truck collects whatever is in here ${next} and pays for it at the going rate. Click your items to put them in. Shift-click puts in one.`),
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: 'calc(var(--u) * 1.2)' } },
        h('div', null, h('h3', null, 'Your bag'), bag),
        h('div', null, h('h3', null, 'In the crate'), crate, h('p', { class: 'price' }, `Worth about ${sim.trader.depotValue()} scrip`))),
      h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.6)' } },
        h('button', { onclick: () => {
          for (let i = 0; i < st.inv.length; i++) {
            const s = st.inv[i];
            if (s && ITEMS[s.id].kind === 'produce') sim.trader.toDepot(i, s.n);
          }
          this.showDepot();
        } }, 'Put in all produce'),
        h('button', { class: 'primary', onclick: () => this.close() }, 'Done'))
    );
    this.show('depot', panel, { sound: this.screenName !== 'depot' });
  }

  // ---- the trader

  showShop(tab: 'buy' | 'sell' = 'buy'): void {
    const sim = this.game.sim()!;
    const st = sim.state;
    const lines: Record<string, string> = {
      buy: '"Seed, shot and bandages. Same as always. Prices are the Hull\'s, not mine."',
      sell: '"I\'ll take produce here if you want the scrip now. The crate gets the same rate when I leave."'
    };
    const body = h('div');
    if (tab === 'buy') {
      const list = h('div', { class: 'list' });
      for (const { id, price } of sim.trader.stock()) {
        const def = ITEMS[id];
        const can = st.player.scrip >= price;
        const extra = def.kind === 'seed' ? `${CROPS[def.crop!].seasons.join(', ')}. ${CROPS[def.crop!].days} days.` : def.desc ?? '';
        list.append(h('div', { class: `line${can ? '' : ' off'}` },
          h('img', { src: iconURL(id) }),
          h('div', null, h('div', null, def.name, h('span', { class: 'faint' }, `  you have ${countItem(st.inv, id)}`)), h('div', { class: 'dim', style: { fontSize: '0.8em' } }, extra)),
          h('div', { class: 'row' }, h('span', { class: 'price' }, `${price}`),
            h('button', { class: 'small', disabled: !can, onclick: () => { sim.trader.buy(id, 1); this.showShop('buy'); } }, 'Buy'),
            h('button', { class: 'small', disabled: st.player.scrip < price * 5, onclick: () => { sim.trader.buy(id, 5); this.showShop('buy'); } }, 'x5'))
        ));
      }
      body.append(list);
    } else {
      const grid = h('div', { class: 'grid' });
      st.inv.forEach((s, i) => {
        const def = s ? ITEMS[s.id] : null;
        const ok = !!def && def.kind !== 'tool' && def.kind !== 'weapon';
        const el = h('div', { class: 'slot', tabindex: 0, html: this.slotHtml(s), title: s && ok ? `${this.itemLabel(s)}: ${sim.sellPrice(s)} each` : '' });
        if (!ok && s) el.style.opacity = '0.35';
        if (ok)
          el.addEventListener('click', e => {
            const got = sim.trader.sellSlot(i, (e as MouseEvent).shiftKey ? 1 : s!.n);
            if (got) this.toast(`Sold for ${got} scrip.`, 'good');
            this.showShop('sell');
          });
        grid.append(el);
      });
      body.append(h('p', { class: 'dim' }, 'Click to sell a stack. Shift-click sells one. Selling a lot of one thing lowers what the Hull will pay for it, for a few days.'), grid);
    }
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 40)' } },
      h('div', { class: 'row spread' }, h('h2', null, `${TRADER.name}, ${TRADER.outfit}`), h('div', { class: 'price' }, `${st.player.scrip} scrip`)),
      h('p', { class: 'quote' }, lines[tab]),
      h('div', { class: 'tabs' },
        h('button', { class: tab === 'buy' ? 'on' : '', onclick: () => this.showShop('buy') }, 'Buy'),
        h('button', { class: tab === 'sell' ? 'on' : '', onclick: () => this.showShop('sell') }, 'Sell')),
      body,
      h('div', { class: 'row', style: { marginTop: 'calc(var(--u) * 0.6)' } }, h('button', { class: 'primary', onclick: () => this.close() }, 'Done'))
    );
    this.show('shop', panel, { sound: this.screenName !== 'shop' });
  }

  // ---- people

  private pips(n: number): HTMLElement {
    const el = h('span', { class: 'pips' });
    for (let i = 0; i < 3; i++) el.append(h('i', { class: i < n ? 'on' : '' }));
    return el;
  }

  showHire(id: string): void {
    const sim = this.game.sim()!;
    const d = HANDS.find(x => x.id === id)!;
    const bunk = sim.hands.freeBunk();
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 30)' } },
      h('h2', null, d.name),
      h('p', { class: 'quote' }, `"${d.pitch}"`),
      h('div', { class: 'keylist' },
        h('span', null, 'Wants'), h('span', { class: 'price' }, `${d.wage} scrip a day, and a bed`),
        h('span', null, 'Watering'), this.pips(d.water),
        h('span', null, 'Harvesting'), this.pips(d.harvest),
        h('span', null, 'Nerve'), this.pips(d.nerve)),
      h('p', { class: bunk ? 'dim' : 'warn' }, bunk ? 'You have a free bunk for them.' : 'You have no free bunk. Make one (wood and cloth) or they will sleep rough and resent it.'),
      h('p', { class: 'faint' }, 'Hands water the crops, pick what is ripe and carry it to the depot crate, from seven until six. You pay them every night. Fail to pay, and they will not stay.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => { sim.hands.hire(id); this.close(); } }, 'Hire'),
        h('button', { onclick: () => { sim.hands.turnAway(); this.toast(`${d.name} nods and walks on toward the Hull.`); this.close(); } }, 'Not today'),
        h('button', { onclick: () => this.close() }, 'Think about it'))
    );
    this.show('hire', panel);
  }

  showHand(id: string): void {
    const sim = this.game.sim()!;
    const h0 = sim.state.hands.find(x => x.id === id);
    if (!h0) return;
    const d = HANDS.find(x => x.id === id)!;
    const mood = h0.morale > 70 ? 'Content' : h0.morale > 40 ? 'Getting by' : h0.morale > 20 ? 'Unhappy' : 'About to walk';
    const carrying = h0.carrying.reduce((a, c) => a + c.n, 0);
    const learnt = h0.daysWorked >= 4;
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 28)' } },
      h('h2', null, d.name),
      h('div', { class: 'keylist' },
        h('span', null, 'Mood'), h('span', { class: h0.morale > 40 ? 'good' : 'bad' }, `${mood} (${Math.round(h0.morale)})`),
        h('span', null, 'Days worked'), h('span', null, String(h0.daysWorked)),
        h('span', null, 'Wage'), h('span', { class: 'price' }, `${d.wage} a day`),
        h('span', null, 'Bed'), h('span', null, h0.bunk ? 'Has a bunk' : 'Sleeping rough'),
        h('span', null, 'Carrying'), h('span', null, carrying ? `${carrying} produce` : 'Nothing')),
      h0.job === 'guard' ? h('p', { class: d.nerve < 2 ? 'warn' : 'dim' }, d.nerve < 2 ? 'They will stand guard if you ask, but they have no nerve for it. It will cost them.' : 'Guards sleep through the day and keep watch by the field from eight at night.') : null,
      learnt ? h('p', { class: 'quote' }, `They told you something, one evening by the fire: ${d.secret.charAt(0).toLowerCase() + d.secret.slice(1)}`) : h('p', { class: 'faint' }, 'They do not say much about where they came from. Not yet.'),
      h('div', { class: 'row wrap' },
        h('button', { class: h0.job === 'tend' ? 'primary' : '', onclick: () => { h0.job = 'tend'; this.showHand(id); } }, 'Tend the crops'),
        h('button', { class: h0.job === 'guard' ? 'primary' : '', onclick: () => { h0.job = 'guard'; this.showHand(id); } }, 'Stand guard at night'),
        h('button', { class: h0.job === 'off' ? 'primary' : '', onclick: () => { h0.job = 'off'; this.showHand(id); } }, 'Take the day off'),
        h('button', { onclick: () => { if (confirm(`Let ${d.name} go? They will not come back.`)) { sim.hands.letGo(id); this.close(); } } }, 'Let them go'),
        h('button', { onclick: () => this.close() }, 'Done'))
    );
    this.show('hand', panel);
  }

  showEnvoy(): void {
    const sim = this.game.sim()!;
    const c = sim.state.crew;
    const canPay = sim.state.player.scrip >= c.demand;
    const kind = Math.round(c.demand * 1.25);
    let produce = 0;
    for (const st of [...sim.state.inv, ...sim.state.depot]) if (st && ITEMS[st.id].kind === 'produce') produce += sim.sellPrice(st) * st.n;
    const first = sim.state.crew.won + sim.state.crew.lost === 0 && !sim.state.flags.metEnvoy;
    sim.state.flags.metEnvoy = 1;
    const speech = first
      ? `"Name's ${CREW.envoy}. I speak for the ${CREW.name}. We keep this road. The trucks get through because we let them. A farm on our road pays its share. ${c.demand} scrip, and nobody bothers you for a week."`
      : `"You know how this goes. ${c.demand} scrip. Or we come and help ourselves."`;
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 32)' } },
      h('h2', null, CREW.envoy),
      h('p', { class: 'quote' }, speech),
      h('p', { class: 'faint' }, 'Paying buys six quiet days. Refusing means they come for the depot crate tonight at ten, with torches. You can fight them. Your guards and a fence will help.'),
      h('div', { class: 'col' },
        h('button', { class: 'primary', disabled: !canPay, onclick: () => { if (sim.raiders.pay()) { this.toast(`${CREW.envoy} counts it twice and tips his hat.`, 'info'); this.close(); } } }, `Pay ${c.demand} scrip${canPay ? '' : ' (you do not have it)'}`),
        h('button', { disabled: produce < kind, onclick: () => { if (sim.raiders.payInKind()) { this.toast('His men load the produce onto a cart.', 'info'); this.close(); } } }, `Pay in produce, about ${kind} worth${produce < kind ? ' (not enough)' : ''}`),
        h('button', { onclick: () => { sim.raiders.refuse(); this.close(); } }, 'Tell him no'),
        h('button', { onclick: () => this.close() }, 'Say nothing yet'))
    );
    this.show('envoy', panel);
  }

  showDocument(key: string): void {
    const sim = this.game.sim()!;
    const d = DOCUMENTS[key];
    if (!d) return;
    if (!sim.state.journal.some(j => j.text === `Found: ${d.title}.`)) sim.state.journal.push({ day: sim.state.day, text: `Found: ${d.title}.` });
    const panel = h('div', { class: 'note' },
      h('p', { style: { fontWeight: '600' } }, d.title),
      d.text.map(t => h('p', null, t)),
      h('button', { class: 'primary', onclick: () => this.close() }, 'Keep it')
    );
    this.show('read', panel);
  }

  showMap(): void {
    const sim = this.game.sim()!;
    const w = sim.world;
    const S = 3;
    const cw = (MAP_W + MAP_H) * S;
    const ch = (MAP_W + MAP_H) * S * 0.5;
    const cv = h('canvas', { width: cw, height: ch, style: { width: '100%', imageRendering: 'pixelated', display: 'block' } }) as HTMLCanvasElement;
    const ctx = cv.getContext('2d')!;
    const col: Record<number, string> = {
      [T.Grass]: '#56632f', [T.Dry]: '#86744a', [T.Dirt]: '#664e36', [T.Track]: '#7a6448', [T.Road]: '#3c3a38', [T.Water]: '#2e555c',
      [T.Deep]: '#1e3a42', [T.Ash]: '#66625c', [T.Concrete]: '#6b675f', [T.Sand]: '#8f7d5a'
    };
    const at = (x: number, y: number) => [(x - y + MAP_H) * S, (x + y) * S * 0.5] as const;
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const k = y * MAP_W + x;
        let c = col[w.terrain[k]];
        if (w.tilled[k]) c = '#3a2a1e';
        if (w.crops.has(k) && !w.crops.get(k)!.dead) c = '#6a9a3a';
        const o = w.objAt[k] ? w.objects.get(w.objAt[k]) : null;
        if (o) {
          if (o.kind.startsWith('tree')) c = '#2c4532';
          else if (o.kind === 'ruin_wall') c = '#8a857a';
          else if (o.kind === 'farmhouse') c = '#a0583a';
          else if (o.kind === 'fence' || o.kind === 'gate') c = '#c8a878';
        }
        const [px, py] = at(x, y);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + S, py + S * 0.5);
        ctx.lineTo(px, py + S);
        ctx.lineTo(px - S, py + S * 0.5);
        ctx.fill();
      }
    const label = (x: number, y: number, text: string, colour = '#f0e6c8') => {
      const [px, py] = at(x, y);
      ctx.font = '10px Pixelify Sans, monospace';
      ctx.fillStyle = '#000';
      ctx.fillText(text, px - ctx.measureText(text).width / 2 + 1, py + 1);
      ctx.fillStyle = colour;
      ctx.fillText(text, px - ctx.measureText(text).width / 2, py);
    };
    label(PLACES.house.x + 2, PLACES.house.y - 1, 'Home');
    label(PLACES.crate.x, PLACES.crate.y + 3, 'Depot');
    label(70, 10, 'Ruins');
    label(86, 6, 'Ash flats', '#c8c0b0');
    label(20, 20, 'The creek', '#a8d0d8');
    label(90, 63, 'Road to the Hull', '#e8b070');
    label(16, 12, 'Pines', '#a8c890');
    // You
    const [mx, my] = at(sim.player.x, sim.player.y);
    ctx.fillStyle = '#fff';
    ctx.fillRect(mx - 2, my - 2, 5, 5);
    ctx.fillStyle = '#d8742a';
    ctx.fillRect(mx - 1, my - 1, 3, 3);
    const found = Object.keys(DOCUMENTS).filter(k => sim.state.flags['read:' + k]).length;
    const panel = h('div', { class: 'panel modal', style: { width: 'min(92vw, 1000px)', maxWidth: 'min(92vw, 1000px)' } },
      h('div', { class: 'row spread' }, h('h2', null, 'The valley'), h('span', { class: 'faint' }, `Papers found ${found} of ${Object.keys(DOCUMENTS).length}`)),
      cv,
      h('p', { class: 'faint' }, 'The orange square is you. Husks come from the ruins and the ash flats in the north-east. The Crew use the road.'),
      h('button', { class: 'primary', onclick: () => this.close() }, 'Close')
    );
    this.show('map', panel);
  }

  showJournal(): void {
    const sim = this.game.sim()!;
    const st = sim.state;
    const gl = goals(sim);
    const panel = h('div', { class: 'panel modal', style: { width: 'calc(var(--u) * 34)' } },
      h('h2', null, 'Journal'),
      h('h3', null, 'Things to get done'),
      h('div', { class: 'list' }, gl.map(([t, done]) => h('div', { class: done ? 'good' : '' }, `${done ? '[x]' : '[ ]'} ${t}`))),
      h('h3', null, 'So far'),
      h('div', { class: 'keylist' },
        h('span', null, 'Days'), h('span', null, String(st.day)),
        h('span', null, 'Harvested'), h('span', null, String(st.stats.harvested)),
        h('span', null, 'Shipped to the Hull'), h('span', null, String(st.stats.shipped)),
        h('span', null, 'Scrip earned'), h('span', { class: 'price' }, String(st.stats.earned)),
        h('span', null, 'Husks put down'), h('span', null, String(st.stats.husks))),
      st.journal.length ? h('h3', null, 'Notes') : null,
      h('div', { class: 'list dim' }, st.journal.slice(-12).reverse().map(j => h('div', null, `Day ${j.day}: ${j.text}`))),
      h('button', { class: 'primary', style: { marginTop: 'calc(var(--u) * 0.8)' }, onclick: () => this.close() }, 'Close')
    );
    this.show('journal', panel);
  }
}

export { VISIT_DAYS };
