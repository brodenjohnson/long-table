// The game controller: owns the loop and wires the simulation to rendering, input, sound, UI and saves.
import { Application, TextureSource } from 'pixi.js';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import { STEP, VERSION } from './core/config';
import { screenToTileVec } from './core/iso';
import { validateData, ITEMS } from './data';
import { Atlas } from './art/atlas';
import { paintProps } from './art/props';
import { paintFarm } from './art/crops';
import { paintVehicles } from './art/vehicles';
import { LOOKS, paintCharacterSet } from './art/rig';
import { Renderer } from './render/renderer';
import { Sim, InputFrame, SimEvent } from './sim/sim';
import { World } from './sim/world';
import { generate, PLACES } from './sim/worldgen';
import { HOTBAR, newGameState } from './sim/state';
import { LocalStore, SLOTS, SaveFile, deserialize, serialize } from './sim/save';
import { Input } from './input/input';
import { Audio } from './audio/audio';
import { DEFAULT_SETTINGS, GameApi, Settings, UI } from './ui/ui';

TextureSource.defaultOptions.scaleMode = 'nearest';

const SETTINGS_KEY = 'longtable.settings';

export class Game implements GameApi {
  app = new Application();
  atlas = new Atlas();
  renderer: Renderer | null = null;
  private simRef: Sim | null = null;
  input!: Input;
  audio = new Audio();
  ui!: UI;
  store = new LocalStore();
  settings: Settings = { ...DEFAULT_SETTINGS };
  slot = 0;
  private acc = 0;
  private freeze = 0;
  private running = false;
  private lastSel = 0;
  private autosaveT = 0;
  private ambT = 0;

  sim(): Sim | null {
    return this.simRef;
  }

  currentSlot(): number {
    return this.slot;
  }

  async init(): Promise<void> {
    validateData();
    this.loadSettings();
    await this.app.init({ resizeTo: window, background: '#0b0d10', antialias: false, roundPixels: true, preference: 'webgl', powerPreference: 'high-performance' });
    document.getElementById('game')!.appendChild(this.app.canvas);
    this.input = new Input(this.app.canvas);
    this.input.setKeys(this.settings.keys);
    this.ui = new UI(this, this.input, this.audio);
    const loading = this.ui.showLoading('Drawing the valley...');
    await new Promise(r => setTimeout(r, 30));
    // Paint all the art up front
    paintProps(this.atlas);
    paintFarm(this.atlas);
    paintVehicles(this.atlas);
    paintCharacterSet(this.atlas, LOOKS.player, ['idle', 'walk', 'swing', 'pour', 'shoot', 'roll', 'hurt', 'dead']);
    paintCharacterSet(this.atlas, LOOKS.husk, ['idle', 'walk', 'claw', 'hurt', 'dead']);
    paintCharacterSet(this.atlas, LOOKS.trader, ['idle', 'walk']);
    this.atlas.build();
    // A world behind the title screen
    const world = new World();
    generate(world, 1);
    const st = newGameState(1, 'Title', PLACES.bed.x + 3, PLACES.bed.y + 4);
    st.minute = 17.4 * 60;
    this.simRef = new Sim(world, st);
    this.renderer = new Renderer(this.app, this.atlas, this.simRef);
    this.renderer.warm();
    this.applySettings();
    loading.remove();
    this.app.ticker.add(t => this.frame(t.deltaMS / 1000));
    // Sound starts on the first click or key
    const unlock = () => {
      this.audio.start();
      this.applySettings();
      window.removeEventListener('mousedown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('mousedown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('beforeunload', () => {
      if (this.running) this.save();
    });
    // Pause when the window loses focus
    window.addEventListener('blur', () => {
      if (this.running && !this.ui.open) this.ui.showPause();
    });
    if (!this.settings.seenNotice) this.ui.showNotice(() => this.ui.showTitle());
    else this.ui.showTitle();
    this.exposeForTests();
  }

  // ------------------------------------------------------------------ settings

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      /* defaults */
    }
  }

  applySettings(): void {
    const s = this.settings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* storage may be blocked */
    }
    this.audio.vol = { master: s.master, music: s.music, sfx: s.sfx, ambience: s.ambience };
    this.audio.applyVolumes();
    if (this.renderer) {
      this.renderer.fx.gore = s.gore;
      this.renderer.zoomBias = s.zoomBias;
    }
    document.documentElement.style.setProperty('--scale', String(s.textScale));
  }

  // ------------------------------------------------------------------ games

  private freeSlot(): number {
    const used = this.store.list();
    for (let i = 0; i < SLOTS; i++) if (!used.some(u => u.slot === i)) return i;
    return used.sort((a, b) => a.savedAt - b.savedAt)[0].slot;
  }

  private startSim(sim: Sim): void {
    this.simRef = sim;
    this.renderer!.setSim(sim);
    this.renderer!.warm();
    this.applySettings();
    this.acc = 0;
  }

  newGame(name: string, difficulty: 'peaceful' | 'normal' | 'hard' = 'normal'): void {
    const seed = (Math.random() * 1e9) | 0;
    const world = new World();
    generate(world, seed);
    const st = newGameState(seed, name, PLACES.bed.x, PLACES.bed.y);
    st.flags.difficulty = difficulty;
    st.journal.push({ day: 1, text: 'Woke in the valley with a note in my own handwriting.' });
    this.slot = this.freeSlot();
    this.startSim(new Sim(world, st));
    this.save();
    this.ui.showIntro(() => this.begin());
  }

  load(slot: number): void {
    const f = this.store.read(slot);
    if (!f) return;
    try {
      const { state, world } = deserialize(f);
      this.slot = slot;
      this.startSim(new Sim(world, state));
      this.begin();
      this.ui.toast(`Welcome back. Day ${state.day}.`, 'good');
    } catch (e) {
      this.ui.toast(String((e as Error).message), 'bad');
      this.ui.showTitle();
    }
  }

  private begin(): void {
    this.running = true;
    this.ui.showHud(true);
    this.audio.start();
    this.applySettings();
  }

  save(): void {
    const sim = this.simRef;
    if (!sim || !this.running) return;
    sim.collectPickups();
    try {
      this.store.write(this.slot, serialize(sim.state, sim.world, VERSION));
    } catch (e) {
      this.ui.toast(`Could not save: ${(e as Error).message}`, 'bad');
    }
  }

  slots() {
    return this.store.list();
  }

  deleteSlot(slot: number): void {
    this.store.remove(slot);
  }

  toTitle(): void {
    this.save();
    this.running = false;
    this.ui.showHud(false);
    this.ui.showTitle();
  }

  sleep(): void {
    this.simRef?.requestSleep();
  }

  exportSave(): void {
    const sim = this.simRef;
    if (!sim) return;
    sim.collectPickups();
    const data = serialize(sim.state, sim.world, VERSION);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `long-table-${sim.state.name.replace(/\W+/g, '-')}-day${sim.state.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  importSave(file: File): void {
    file.text().then(txt => {
      try {
        const data = JSON.parse(txt) as SaveFile;
        if (!data.state || !data.world) throw new Error('That file is not a Long Table save.');
        const slot = this.freeSlot();
        this.store.write(slot, data);
        this.ui.toast(`Imported ${data.state.name}, day ${data.state.day}.`, 'good');
        this.ui.close();
        this.load(slot);
      } catch (e) {
        this.ui.toast(String((e as Error).message), 'bad');
      }
    });
  }

  worldToScreen(x: number, y: number, z = 0) {
    return this.renderer!.worldToScreen(x, y, z);
  }

  // ------------------------------------------------------------------ loop

  private buildInput(): InputFrame {
    const inp = this.input;
    const sim = this.simRef!;
    const mv = inp.moveVector();
    let aim: InputFrame['aim'] = null;
    const sel = sim.selected();
    const ranged = sel?.id === 'pistol';
    if (inp.device === 'pad') {
      const a = inp.padAim;
      const mag = Math.hypot(a.x, a.y);
      if (mag > 0.3) {
        const v = screenToTileVec(a.x / mag, a.y / mag);
        const len = Math.hypot(v.x, v.y) || 1;
        const d = ranged ? 6 : 1.2;
        aim = { x: sim.player.x + (v.x / len) * d, y: sim.player.y + (v.y / len) * d };
      }
    } else if (inp.mouse.inside && !this.ui.open) {
      aim = this.renderer!.screenToWorld(inp.mouse.x, inp.mouse.y);
      // Aim at the body, not the feet: nudge up the screen a little
      const lifted = this.renderer!.screenToWorld(inp.mouse.x, inp.mouse.y + 10 * this.renderer!.zoom);
      if (ranged) aim = lifted;
    }
    return {
      moveX: mv.x,
      moveY: mv.y,
      aim,
      use: inp.mouseHeld(0) || inp.padHeld('A') || inp.padHeld('RT'),
      usePressed: inp.mouseClicked(0) || inp.padButton('A') || inp.padButton('RT'),
      interact: inp.pressed('interact') || inp.mouseClicked(2) || inp.padButton('X'),
      dodge: inp.pressed('dodge') || inp.padButton('B'),
      lantern: inp.pressed('lantern')
    };
  }

  private frame(dt: number): void {
    dt = Math.min(dt, 0.1);
    const inp = this.input;
    inp.pollPad();
    const sim = this.simRef;
    if (!sim || !this.renderer) return;
    inp.blockWorld = this.ui.open;
    if (this.ui.open) this.ui.navigate();

    if (this.running && !this.ui.open) {
      // Menu keys
      if (inp.pressed('pause')) this.ui.showPause();
      else if (inp.pressed('inventory')) this.ui.showBag('bag');
      else if (inp.pressed('craft')) this.ui.showBag('make');
      else if (inp.pressed('journal')) this.ui.showJournal();
      for (let i = 0; i < HOTBAR; i++) if (inp.pressed(`hot${i + 1}` as 'hot1')) sim.state.sel = i;
      const wheel = inp.takeWheel();
      const step = (inp.pressed('next') ? 1 : 0) - (inp.pressed('prev') ? 1 : 0) + Math.sign(wheel);
      if (step) sim.state.sel = (sim.state.sel + step + HOTBAR) % HOTBAR;
      if (inp.pressed('zoomIn')) {
        this.settings.zoomBias = Math.min(3, this.settings.zoomBias + 1);
        this.applySettings();
      }
      if (inp.pressed('zoomOut')) {
        this.settings.zoomBias = Math.max(-1, this.settings.zoomBias - 1);
        this.applySettings();
      }
      if (sim.state.sel !== this.lastSel) {
        this.lastSel = sim.state.sel;
        this.audio.play('ui_click', undefined, undefined, 0.5);
      }
      // Fixed steps
      if (this.freeze > 0) this.freeze -= dt;
      else {
        this.acc += dt;
        let n = 0;
        while (this.acc >= STEP && n < 6) {
          const frame = this.buildInput();
          sim.step(frame);
          // Pressed inputs apply to the first step only
          inp.endFrame();
          this.acc -= STEP;
          n++;
          this.handleEvents(sim);
          if (this.ui.open || this.freeze > 0) break;
        }
      }
    } else {
      inp.takeWheel();
      if (!this.running) {
        // Title: let the evening play out behind the menu
        sim.state.minute += dt / 3;
        if (sim.state.minute > 19.6 * 60) sim.state.minute = 17.2 * 60;
      }
    }
    inp.endFrame();
    this.renderer.render(dt);
    if (this.running) this.ui.updateHud(sim, dt);
    this.updateSound(sim, dt);
    this.autosaveT += dt;
    if (this.running && this.autosaveT > 90) {
      this.autosaveT = 0;
      this.save();
    }
  }

  private handleEvents(sim: Sim): void {
    const r = this.renderer!;
    const evs = sim.events.splice(0);
    for (const e of evs) this.handle(e, sim, r);
  }

  private handle(e: SimEvent, sim: Sim, r: Renderer): void {
    switch (e.t) {
      case 'sfx':
        this.audio.play(e.name, e.x, e.y, e.vol ?? 1);
        break;
      case 'toast':
        this.ui.toast(e.text, e.kind);
        break;
      case 'fx':
        if (e.kind === 'muzzle') r.muzzleFlash(e.x, e.y);
        r.fx.burst(e.kind, e.x, e.y, e.z ?? 0, e.n ?? 6, e.dx ?? 0, e.dy ?? 0);
        break;
      case 'decal':
        r.fx.decal(e.kind, e.x, e.y);
        break;
      case 'shake':
        if (this.settings.shake) r.addShake(e.amt);
        break;
      case 'hitstop':
        this.freeze = Math.max(this.freeze, e.ms / 1000);
        break;
      case 'tracer':
        r.tracer(e.x0, e.y0, e.x1, e.y1);
        break;
      case 'ground':
        r.onGroundChanged();
        break;
      case 'float':
        this.ui.float(e.text, e.x, e.y, e.colour);
        break;
      case 'hit':
        r.wobble(e.id);
        break;
      case 'open':
        this.openScreen(e.what, e.id);
        break;
      case 'dayEnded':
        this.onDayEnded(sim, e.passedOut);
        break;
    }
  }

  private openScreen(what: string, id?: string): void {
    const sim = this.simRef!;
    switch (what) {
      case 'sleep':
        this.ui.showSleep();
        break;
      case 'depot':
        this.ui.showDepot();
        break;
      case 'shop':
        this.ui.showShop('buy');
        break;
      case 'hire':
        this.ui.showHire(id!);
        break;
      case 'hand':
        this.ui.showHand(id!);
        break;
      case 'radio':
        this.ui.showRadio(sim);
        break;
    }
  }

  private onDayEnded(sim: Sim, passedOut: boolean): void {
    this.renderer!.onGroundChanged();
    this.renderer!.fx.clearDecals();
    this.save();
    this.audio.play('day_end');
    this.ui.fade(true);
    this.running = false;
    setTimeout(() => {
      this.ui.fade(false);
      this.ui.showReport(sim, () => {
        this.running = true;
      });
    }, passedOut ? 900 : 650);
  }

  private updateSound(sim: Sim, dt: number): void {
    if (!this.audio.running) return;
    this.audio.listener = { x: sim.player.x, y: sim.player.y };
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 0.5;
      const h = (sim.state.minute / 60) % 24;
      const night = h >= 20 || h < 5.5;
      const nearFire = Math.hypot(sim.player.x - PLACES.campfire.x, sim.player.y - PLACES.campfire.y);
      // Distance to the creek, roughly
      let creek = 99;
      for (let dy = -6; dy <= 6; dy += 2)
        for (let dx = -10; dx <= 10; dx += 2) if (sim.world.isWater(Math.floor(sim.player.x + dx), Math.floor(sim.player.y + dy))) creek = Math.min(creek, Math.hypot(dx, dy));
      const warm = sim.season === 'Green' || sim.season === 'Dry';
      this.audio.setAmbience({
        wind: sim.state.weather === 'dust' ? 1.2 : 0.35 + (night ? 0.1 : 0),
        rain: sim.state.weather === 'rain' ? 0.8 : 0,
        creek: Math.max(0, 1 - creek / 10) * 0.6,
        fire: night || h > 18 ? Math.max(0, 1 - nearFire / 7) : 0,
        crickets: night && warm && sim.state.weather !== 'rain' ? 1 : 0
      });
      this.audio.mood = h < 9 && h >= 5 ? 'morning' : h < 17 ? 'day' : h < 20.5 ? 'evening' : 'night';
    }
    this.audio.updateMusic();
  }

  // ------------------------------------------------------------------ tests

  private exposeForTests(): void {
    const g = this;
    (window as unknown as { __game: unknown }).__game = {
      ready: true,
      game: g,
      get sim() {
        return g.simRef;
      },
      get running() {
        return g.running;
      },
      ITEMS,
      newGame: (name = 'Tester', difficulty: 'peaceful' | 'normal' | 'hard' = 'normal') => {
        g.settings.seenNotice = true;
        g.ui.close();
        g.newGame(name, difficulty);
        g.ui.close();
        g.begin();
      },
      /** Advance the simulation by n seconds with no input. */
      advance: (seconds: number) => {
        const sim = g.simRef!;
        const n = Math.round(seconds / STEP);
        for (let i = 0; i < n; i++) {
          sim.step({ moveX: 0, moveY: 0, aim: null, use: false, usePressed: false, interact: false, dodge: false, lantern: false });
          g.handleEvents(sim);
        }
      },
      /** One step with the given input. */
      stepWith: (frame: Partial<InputFrame>) => {
        const sim = g.simRef!;
        sim.step({ moveX: 0, moveY: 0, aim: null, use: false, usePressed: false, interact: false, dodge: false, lantern: false, ...frame });
        g.handleEvents(sim);
      },
      closeUi: () => g.ui.close(),
      get screen() {
        return g.ui.screenName;
      }
    };
  }
}
