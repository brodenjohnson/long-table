// Draws the valley from the simulation's state. Holds no game rules.
import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js';
import { MAP_H, MAP_W } from '../core/config';
import { toScreen, toTile } from '../core/iso';
import { Atlas } from '../art/atlas';
import { FRAMES, LOOKS, handLook, frameName, paintCharacterSet, Anim, Tool } from '../art/rig';
import { cropStage } from '../art/crops';
import { iconCanvas } from '../art/icons';
import { CROPS, HANDS, ITEMS, OBJECTS } from '../data';
import { GroundLayer } from './ground';
import { Fx } from './fx';
import { idx } from '../sim/world';
import { PLACES } from '../sim/worldgen';
import type { Sim } from '../sim/sim';

/** Pixi keeps a sprite's anchor when its texture changes, so set both together. */
function setTex(s: Sprite, t: Texture): void {
  if (s.texture !== t) s.texture = t;
  s.anchor.set(t.defaultAnchor?.x ?? 0, t.defaultAnchor?.y ?? 0);
}

const FPS: Record<Anim, number> = { idle: 1.6, walk: 10, swing: 0, pour: 0, shoot: 0, roll: 0, hurt: 1, dead: 1, claw: 0 };

interface CharSprite {
  body: Sprite;
  shadow: Sprite;
}

export class Renderer {
  readonly root = new Container();
  readonly ground: GroundLayer;
  private soil = new Container();
  private cursor = new Sprite();
  private ghost = new Sprite();
  private shadows = new Container();
  private objs = new Container();
  readonly fx: Fx;
  private lightLayer = new Container();
  private lightRT: RenderTexture;
  private lightSprite: Sprite;
  private weather = new Container();
  private rain: Sprite[] = [];
  private dustTint = new Graphics();
  private flash = new Graphics();

  private objSprites = new Map<number, { s: Sprite; key: string; shadow?: Sprite; extra?: Sprite }>();
  private cropSprites = new Map<number, { s: Sprite; key: string }>();
  private soilSprites = new Map<number, { s: Sprite; key: string }>();
  private chars = new Map<string, CharSprite>();
  private pickupSprites = new Map<number, Sprite>();
  private iconTex = new Map<string, Texture>();
  private truck = new Sprite();
  private truckShadow = new Sprite();
  private lights: Sprite[] = [];
  private soilDirty = true;

  zoom = 2;
  zoomBias = 0;
  cam = { x: 0, y: 0 };
  private shake = 0;
  private flashT = 0;
  private time = 0;
  private waterTiles: [number, number][] = [];

  constructor(private app: Application, readonly atlas: Atlas, private sim: Sim) {
    this.ground = new GroundLayer(sim.world, sim.state.seed);
    this.fx = new Fx(atlas);
    this.root.addChild(this.ground.view, this.soil, this.fx.decals, this.cursor, this.shadows, this.objs, this.fx.view);
    this.objs.sortableChildren = true;
    this.shadows.alpha = 0.3;
    this.cursor.visible = false;
    this.ghost.alpha = 0.55;
    this.ghost.zIndex = 1e9;
    this.objs.addChild(this.ghost);
    this.truck.visible = false;
    this.objs.addChild(this.truck);
    this.truckShadow.texture = atlas.get('shadow:xl');
    this.truckShadow.scale.set(0.7, 0.5);
    this.truckShadow.visible = false;
    this.shadows.addChild(this.truckShadow);
    app.stage.addChild(this.root);
    // Light map: rendered at native resolution, multiplied over the scene
    this.lightRT = RenderTexture.create({ width: 64, height: 64 });
    this.lightSprite = new Sprite(this.lightRT);
    this.lightSprite.blendMode = 'multiply';
    app.stage.addChild(this.lightSprite);
    // Weather and full-screen flashes on top
    app.stage.addChild(this.weather);
    this.weather.addChild(this.dustTint);
    for (let i = 0; i < 260; i++) {
      const s = new Sprite(Texture.WHITE);
      s.width = 1;
      s.height = 7;
      s.alpha = 0.35;
      s.tint = 0xb8d0e0;
      s.rotation = 0.25;
      s.visible = false;
      this.weather.addChild(s);
      this.rain.push(s);
    }
    app.stage.addChild(this.flash);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (sim.world.isWater(x, y)) this.waterTiles.push([x, y]);
    this.cam = { ...toScreen(sim.player.x, sim.player.y) };
  }

  /** Swap in a new simulation (after loading or a new game). */
  setSim(sim: Sim): void {
    this.sim = sim;
    this.ground.view.removeChildren();
    (this as { ground: GroundLayer }).ground = new GroundLayer(sim.world, sim.state.seed);
    this.root.addChildAt(this.ground.view, 0);
    for (const v of this.objSprites.values()) {
      v.s.destroy();
      v.shadow?.destroy();
      v.extra?.destroy();
    }
    this.objSprites.clear();
    for (const v of this.cropSprites.values()) v.s.destroy();
    this.cropSprites.clear();
    for (const v of this.soilSprites.values()) v.s.destroy();
    this.soilSprites.clear();
    for (const c of this.chars.values()) {
      c.body.destroy();
      c.shadow.destroy();
    }
    this.chars.clear();
    for (const p of this.pickupSprites.values()) p.destroy();
    this.pickupSprites.clear();
    this.fx.clearDecals();
    this.soilDirty = true;
    this.waterTiles = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (sim.world.isWater(x, y)) this.waterTiles.push([x, y]);
    this.cam = { ...toScreen(sim.player.x, sim.player.y) };
  }

  /** Paint the ground synchronously, for a clean first frame. */
  warm(): void {
    this.ground.buildAll();
  }

  // ------------------------------------------------------------------ events from the sim

  onGroundChanged(): void {
    this.soilDirty = true;
  }

  addShake(a: number): void {
    this.shake = Math.min(6, this.shake + a);
  }

  screenFlash(colour: number, t: number): void {
    this.flashT = t;
    this.flash.clear().rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color: colour, alpha: 1 });
  }

  // ------------------------------------------------------------------ coordinates

  computeZoom(): number {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const z = Math.max(2, Math.min(6, Math.floor(Math.min(w / 560, h / 350))));
    return Math.max(1, Math.min(7, z + this.zoomBias));
  }

  /** Screen pixel to world tile position. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const nx = (sx - this.root.position.x) / this.zoom;
    const ny = (sy - this.root.position.y) / this.zoom;
    return toTile(nx, ny);
  }

  worldToScreen(wx: number, wy: number, z = 0): { x: number; y: number } {
    const p = toScreen(wx, wy, z);
    return { x: p.x * this.zoom + this.root.position.x, y: p.y * this.zoom + this.root.position.y };
  }

  // ------------------------------------------------------------------ frame

  render(dt: number): void {
    const sim = this.sim;
    this.time += dt;
    this.zoom = this.computeZoom();
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    // Camera follows the player, eased
    const target = toScreen(sim.player.x, sim.player.y, 12);
    const k = 1 - Math.exp(-dt * 7);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.shake = Math.max(0, this.shake - dt * 14);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.root.scale.set(this.zoom);
    this.root.position.set(Math.round(W / 2 - Math.round(this.cam.x + sx) * this.zoom), Math.round(H / 2 - Math.round(this.cam.y + sy) * this.zoom));

    // Visible tile range (generous)
    const c0 = this.screenToWorld(0, 0);
    const c1 = this.screenToWorld(W, 0);
    const c2 = this.screenToWorld(0, H);
    const c3 = this.screenToWorld(W, H);
    const view = {
      x0: Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)) - 2,
      y0: Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)) - 2,
      x1: Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)) + 2,
      y1: Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)) + 4
    };
    this.ground.update(view, 3);
    if (this.soilDirty) this.syncSoil();
    this.syncObjects(view);
    this.syncCrops(view);
    this.syncCharacters(dt);
    this.syncTruck();
    this.syncPickups();
    this.syncCursor();
    this.ambientFx(dt, view);
    this.fx.update(dt);
    this.drawTracers(dt);
    this.renderLights(W, H);
    this.renderWeather(dt, W, H);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.alpha = Math.max(0, this.flashT * 4);
    } else this.flash.alpha = 0;
  }

  private inView(x: number, y: number, v: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1 && x + y >= v.x0 + v.y0 + 2 - 6;
  }

  // ------------------------------------------------------------------ soil

  private syncSoil(): void {
    this.soilDirty = false;
    const w = this.sim.world;
    const seen = new Set<number>();
    for (let k = 0; k < w.tilled.length; k++) {
      if (!w.tilled[k]) continue;
      seen.add(k);
      const key = w.wet[k] ? 'soil:wet' : 'soil:dry';
      let e = this.soilSprites.get(k);
      if (!e) {
        const s = new Sprite(this.atlas.get(key));
        const x = k % MAP_W;
        const y = Math.floor(k / MAP_W);
        const p = toScreen(x, y);
        s.position.set(p.x, p.y + 0);
        s.anchor.set(0.5, 0);
        s.position.set(p.x, p.y);
        this.soil.addChild(s);
        e = { s, key };
        this.soilSprites.set(k, e);
      }
      if (e.key !== key) {
        e.s.texture = this.atlas.get(key);
        e.key = key;
      }
    }
    for (const [k, e] of this.soilSprites)
      if (!seen.has(k)) {
        e.s.destroy();
        this.soilSprites.delete(k);
      }
  }

  // ------------------------------------------------------------------ objects

  private fenceMask(x: number, y: number): number {
    const w = this.sim.world;
    const is = (tx: number, ty: number) => {
      const o = w.objectAt(tx, ty);
      return !!o && (o.kind === 'fence' || o.kind === 'gate');
    };
    return (is(x + 1, y) ? 1 : 0) | (is(x, y + 1) ? 2 : 0) | (is(x - 1, y) ? 4 : 0) | (is(x, y - 1) ? 8 : 0);
  }

  private objectKey(o: { kind: string; x: number; y: number; v: number; s?: Record<string, number | string> }): string {
    if (o.kind === 'fence' || o.kind === 'gate') return `${o.kind}:${this.fenceMask(o.x, o.y)}`;
    if (o.kind === 'lamp') return this.sim.isNight() || this.lightLevel() < 0.75 ? 'obj:lamp:on' : 'obj:lamp:0';
    if (o.kind === 'compost_bin') return o.s?.ready ? 'obj:compost_bin:ready' : 'obj:compost_bin:0';
    if (o.kind === 'rain_barrel') return Number(o.s?.water ?? 0) > 0 ? 'obj:rain_barrel:full' : 'obj:rain_barrel:0';
    const name = `obj:${o.kind}:${o.v}`;
    return this.atlas.tryGet(name) ? name : `obj:${o.kind}:0`;
  }

  private syncObjects(view: { x0: number; y0: number; x1: number; y1: number }): void {
    const w = this.sim.world;
    const seen = new Set<number>();
    for (const o of w.objects.values()) {
      seen.add(o.id);
      const d = OBJECTS[o.kind];
      const cx = o.x + d.w / 2;
      const cy = o.y + d.h / 2;
      let e = this.objSprites.get(o.id);
      const key = this.objectKey(o);
      if (!e) {
        const s = new Sprite(this.atlas.get(key));
        const p = toScreen(cx, cy);
        s.position.set(p.x, p.y);
        s.zIndex = (cx + cy) * 10 - (o.kind === 'spike_trap' ? 5 : 0);
        this.objs.addChild(s);
        e = { s, key };
        const big = o.kind === 'tree_pine' || o.kind === 'tree_dead' || o.kind === 'boulder';
        if (big || o.kind === 'rock' || o.kind === 'saltbush' || o.kind === 'scrap_pile' || o.kind === 'well' || o.kind === 'wreck') {
          const sh = new Sprite(this.atlas.get(o.kind === 'tree_pine' ? 'shadow:l' : big || o.kind === 'wreck' ? 'shadow:l' : 'shadow:m'));
          sh.position.set(p.x + 3, p.y + 1);
          this.shadows.addChild(sh);
          e.shadow = sh;
        }
        if (o.kind === 'campfire') {
          const f = new Sprite(this.atlas.get('fire:0'));
          f.position.set(p.x, p.y - 1);
          f.zIndex = s.zIndex + 0.1;
          this.objs.addChild(f);
          e.extra = f;
        }
        this.objSprites.set(o.id, e);
      }
      if (e.key !== key) {
        setTex(e.s, this.atlas.get(key));
        e.key = key;
      }
      const vis = this.inView(cx, cy, view);
      e.s.visible = vis;
      if (e.shadow) e.shadow.visible = vis;
      if (e.extra) {
        e.extra.visible = vis;
        e.extra.texture = this.atlas.get(`fire:${Math.floor(this.time * 8) % 4}`);
      }
    }
    for (const [id, e] of this.objSprites)
      if (!seen.has(id)) {
        e.s.destroy();
        e.shadow?.destroy();
        e.extra?.destroy();
        this.objSprites.delete(id);
      }
  }

  private syncCrops(view: { x0: number; y0: number; x1: number; y1: number }): void {
    const w = this.sim.world;
    const seen = new Set<number>();
    for (const [k, c] of w.crops) {
      seen.add(k);
      const def = CROPS[c.kind];
      const x = k % MAP_W;
      const y = Math.floor(k / MAP_W);
      let key: string;
      if (c.dead) key = `crop:${c.kind}:dead`;
      else {
        const st = cropStage(def, c.age, c.ripe);
        const tainted = st >= 2 && w.contam[k] > 0.38 && !def.hardy;
        key = `crop:${c.kind}:${st}${tainted ? ':t' : ''}`;
      }
      let e = this.cropSprites.get(k);
      if (!e) {
        const s = new Sprite(this.atlas.get(key));
        const p = toScreen(x + 0.5, y + 0.5);
        s.position.set(p.x, p.y + 1);
        s.zIndex = (x + y + 1) * 10 - 0.5;
        this.objs.addChild(s);
        e = { s, key };
        this.cropSprites.set(k, e);
      }
      if (e.key !== key) {
        e.s.texture = this.atlas.get(key);
        e.key = key;
      }
      e.s.visible = this.inView(x, y, view);
      // Ripe crops sway a touch
      e.s.skew.x = c.ripe ? Math.sin(this.time * 2 + k) * 0.04 : 0;
    }
    for (const [k, e] of this.cropSprites)
      if (!seen.has(k)) {
        e.s.destroy();
        this.cropSprites.delete(k);
      }
  }

  // ------------------------------------------------------------------ characters

  private charSprite(id: string): CharSprite {
    let c = this.chars.get(id);
    if (!c) {
      const body = new Sprite();
      const shadow = new Sprite(this.atlas.get('shadow:s'));
      shadow.anchor.set(0.5);
      this.objs.addChild(body);
      this.shadows.addChild(shadow);
      c = { body, shadow };
      this.chars.set(id, c);
    }
    return c;
  }

  private ensureLook(lookId: string): void {
    if (this.atlas.tryGet(frameName(lookId, 'idle', 0, 0))) return;
    let look = LOOKS[lookId];
    if (!look && lookId.startsWith('hand_')) {
      const id = lookId.slice(5);
      look = handLook(HANDS.findIndex(h => h.id === id), id);
    }
    paintCharacterSet(this.atlas, look, ['idle', 'walk', 'swing', 'pour', 'dead', 'hurt']);
    this.atlas.build();
  }

  private placeChar(id: string, lookId: string, x: number, y: number, dir: number, anim: Anim, animT: number, tool: Tool, extra?: { flash?: boolean; alpha?: number; z?: number }): void {
    const c = this.charSprite(id);
    const n = FRAMES[anim];
    let f: number;
    if (FPS[anim] > 0) f = Math.floor(animT * FPS[anim]) % n;
    else f = Math.min(n - 1, Math.floor((animT / this.actionDur(anim)) * n));
    let name = frameName(lookId, anim, dir, f, tool);
    let tex = this.atlas.tryGet(name);
    if (!tex) tex = this.atlas.tryGet(frameName(lookId, anim, dir, f, 'none'));
    if (!tex) {
      name = frameName(lookId, anim === 'claw' ? 'walk' : 'idle', dir, 0);
      tex = this.atlas.tryGet(name) ?? this.atlas.get(frameName('player', 'idle', dir, 0));
    }
    setTex(c.body, tex);
    const p = toScreen(x, y);
    c.body.position.set(Math.round(p.x), Math.round(p.y - (extra?.z ?? 0)));
    c.body.zIndex = (x + y) * 10 + 0.2;
    c.body.tint = extra?.flash ? 0xff9a8a : 0xffffff;
    c.body.alpha = extra?.alpha ?? 1;
    c.body.visible = true;
    c.shadow.position.set(Math.round(p.x + 1), Math.round(p.y));
    c.shadow.visible = anim !== 'dead';
    c.shadow.alpha = extra?.alpha ?? 1;
  }

  private actionDur(anim: Anim): number {
    return anim === 'swing' ? 0.46 : anim === 'pour' ? 0.44 : anim === 'shoot' ? 0.32 : anim === 'roll' ? 0.34 : anim === 'claw' ? 0.6 : 0.5;
  }

  private syncCharacters(dt: number): void {
    const sim = this.sim;
    const seen = new Set<string>();
    const p = sim.player;
    let pAnim = p.anim;
    let pT = p.animT;
    if (sim.action) {
      pAnim = sim.action.kind;
      pT = (sim.action.t / sim.action.dur) * this.actionDur(pAnim);
    }
    if (sim.roll) pT = 0.34 - sim.roll.t;
    const blink = sim.invuln > 0 && !sim.roll && Math.floor(this.time * 20) % 2 === 0;
    this.placeChar('player', 'player', p.x, p.y, p.dir, pAnim, pT, sim.action?.tool ?? 'none', { alpha: blink ? 0.5 : 1, flash: sim.hurtT > 0 });
    seen.add('player');

    for (const h of sim.night.husks) {
      const id = 'husk' + h.id;
      seen.add(id);
      let a = h.anim;
      let t = h.animT;
      if (a === 'claw') t = h.state === 'windup' ? Math.min(0.29, h.t * 0.5) : 0.3 + Math.min(0.29, h.t);
      const alpha = h.state === 'dead' ? Math.max(0, 1 - Math.max(0, h.t - 12) / 6) : h.state === 'leave' ? Math.max(0, 1 - h.t / 25) : 1;
      this.placeChar(id, 'husk', h.x, h.y, h.dir, a, t, 'none', { flash: h.flash > 0, alpha });
    }

    for (const h of sim.state.hands) {
      const id = 'hand' + h.id;
      seen.add(id);
      this.ensureLook('hand_' + h.id);
      const v = sim.hands.view(h);
      this.placeChar(id, 'hand_' + h.id, h.x, h.y, h.dir, v.anim, v.animT, v.tool);
    }

    const ap = sim.hands.applicantPos();
    if (ap && sim.state.applicant) {
      const id = 'applicant';
      seen.add(id);
      this.ensureLook('hand_' + sim.state.applicant.id);
      this.placeChar(id, 'hand_' + sim.state.applicant.id, ap.x, ap.y, 6, 'idle', this.time, 'none');
    }

    const tr = sim.trader.npcPos();
    if (tr) {
      seen.add('trader');
      this.placeChar('trader', 'trader', tr.x, tr.y, tr.dir, 'idle', this.time, 'none');
    }

    for (const [id, c] of this.chars)
      if (!seen.has(id)) {
        c.body.destroy();
        c.shadow.destroy();
        this.chars.delete(id);
      }
    void dt;
  }

  private syncTruck(): void {
    const t = this.sim.trader.truck;
    if (t.state === 'away') {
      this.truck.visible = false;
      this.truckShadow.visible = false;
      return;
    }
    this.truck.visible = true;
    setTex(this.truck, this.atlas.get(`truck:${t.dir}`));
    const p = toScreen(t.x, t.y);
    const bob = t.state === 'parked' ? 0 : Math.round(Math.sin(t.bounce * 22) * 0.6);
    this.truck.position.set(Math.round(p.x), Math.round(p.y) + bob);
    this.truck.zIndex = (t.x + t.y + 0.6) * 10;
    this.truckShadow.visible = true;
    this.truckShadow.anchor.set(0.5);
    this.truckShadow.position.set(Math.round(p.x + 4), Math.round(p.y + 2));
  }

  private iconTexture(id: string): Texture {
    let t = this.iconTex.get(id);
    if (!t) {
      t = Texture.from(iconCanvas(id));
      t.source.scaleMode = 'nearest';
      this.iconTex.set(id, t);
    }
    return t;
  }

  private syncPickups(): void {
    const seen = new Set<number>();
    for (const u of this.sim.pickups) {
      seen.add(u.id);
      let s = this.pickupSprites.get(u.id);
      if (!s) {
        s = new Sprite(this.iconTexture(u.item.id));
        s.anchor.set(0.5, 1);
        s.scale.set(0.75);
        this.objs.addChild(s);
        this.pickupSprites.set(u.id, s);
      }
      const p = toScreen(u.x, u.y, u.z + (u.z === 0 ? Math.sin(this.time * 4 + u.id) * 1.2 + 2 : 0));
      s.position.set(Math.round(p.x), Math.round(p.y));
      s.zIndex = (u.x + u.y) * 10 + 0.3;
    }
    for (const [id, s] of this.pickupSprites)
      if (!seen.has(id)) {
        s.destroy();
        this.pickupSprites.delete(id);
      }
  }

  private syncCursor(): void {
    const t = this.sim.target;
    const sel = this.sim.selected();
    this.ghost.visible = false;
    if (!t || this.sim.dead) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cursor.texture = this.atlas.get(t.ok ? (t.kind === 'place' ? 'cursor:place' : 'cursor:ok') : 'cursor:bad');
    const p = toScreen(t.x, t.y);
    this.cursor.position.set(p.x, p.y);
    this.cursor.anchor.set(0.5, 0);
    this.cursor.alpha = 0.75 + Math.sin(this.time * 6) * 0.2;
    if (t.kind === 'place' && sel) {
      const kind = ITEMS[sel.id].place!;
      const key = kind === 'fence' || kind === 'gate' ? `${kind}:0` : `obj:${kind}:0`;
      setTex(this.ghost, this.atlas.get(key));
      const c = toScreen(t.x + 0.5, t.y + 0.5);
      this.ghost.position.set(c.x, c.y);
      this.ghost.tint = t.ok ? 0xc8ffc8 : 0xff8080;
      this.ghost.visible = true;
    }
  }

  // ------------------------------------------------------------------ ambience

  private ambientFx(dt: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const sim = this.sim;
    // Water glints
    if (this.waterTiles.length && Math.random() < dt * 14) {
      const [x, y] = this.waterTiles[Math.floor(Math.random() * this.waterTiles.length)];
      if (this.inView(x, y, view)) this.fx.burst('sparkle', x + Math.random(), y + Math.random(), 0, 1);
    }
    // Chimney smoke in the cold and the evening
    const h = (sim.state.minute / 60) % 24;
    if ((h > 17 || h < 9 || sim.season === 'Cold') && Math.random() < dt * 1.6) this.fx.burst('smoke', PLACES.house.x + 1.25, PLACES.house.y + 1.05, 64, 1);
    // Campfire embers at night
    if (sim.isNight() && Math.random() < dt * 5) this.fx.burst('ember', PLACES.campfire.x + 0.5, PLACES.campfire.y + 0.5, 6, 1);
    // Fireflies near the creek on warm nights
    if (sim.isNight() && (sim.season === 'Green' || sim.season === 'Dry') && Math.random() < dt * 2) {
      const [x, y] = this.waterTiles[Math.floor(Math.random() * this.waterTiles.length)] ?? [0, 0];
      if (this.inView(x, y, view)) this.fx.burst('firefly', x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, 8, 1);
    }
  }

  /** 0 = full night, 1 = full day. */
  lightLevel(): number {
    const h = (this.sim.state.minute / 60) % 24;
    if (h >= 7 && h < 17.5) return 1;
    if (h >= 5 && h < 7) return (h - 5) / 2;
    if (h >= 17.5 && h < 20.5) return 1 - (h - 17.5) / 3;
    return 0;
  }

  private ambient(): [number, number, number] {
    const sim = this.sim;
    const h = (sim.state.minute / 60) % 24;
    const day: [number, number, number] = sim.state.weather === 'dust' ? [1, 0.86, 0.68] : sim.state.weather === 'rain' ? [0.78, 0.82, 0.9] : sim.state.weather === 'cloud' ? [0.9, 0.92, 0.96] : sim.state.weather === 'frost' ? [0.92, 0.96, 1.04] : [1, 1, 1];
    const night: [number, number, number] = [0.13, 0.14, 0.26];
    const dusk: [number, number, number] = [1.0, 0.68, 0.5];
    const dawn: [number, number, number] = [0.8, 0.7, 0.78];
    const mixC = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    if (h >= 7 && h < 17) return day;
    if (h >= 17 && h < 19) return mixC(day, dusk, (h - 17) / 2);
    if (h >= 19 && h < 21) return mixC(dusk, night, (h - 19) / 2);
    if (h >= 5 && h < 6) return mixC(night, dawn, h - 5);
    if (h >= 6 && h < 7) return mixC(dawn, day, h - 6);
    return night;
  }

  private renderLights(W: number, H: number): void {
    const sim = this.sim;
    const amb = this.ambient();
    const full = amb[0] >= 0.999 && amb[1] >= 0.999 && amb[2] >= 0.999;
    if (full) {
      this.lightSprite.visible = false;
      return;
    }
    this.lightSprite.visible = true;
    const nw = Math.ceil(W / this.zoom) + 2;
    const nh = Math.ceil(H / this.zoom) + 2;
    if (this.lightRT.width !== nw || this.lightRT.height !== nh) this.lightRT.resize(nw, nh);
    // Native-pixel offset of the top-left of the screen in world space
    const ox = -this.root.position.x / this.zoom;
    const oy = -this.root.position.y / this.zoom;
    const darkness = 1 - Math.min(amb[0], amb[1], amb[2]);
    let li = 0;
    const light = (wx: number, wy: number, z: number, r: number, colour: number, strength: number) => {
      let s = this.lights[li];
      if (!s) {
        s = new Sprite(this.atlas.get('light'));
        s.anchor.set(0.5);
        s.blendMode = 'add';
        this.lights.push(s);
        this.lightLayer.addChild(s);
      }
      li++;
      const p = toScreen(wx, wy, z);
      s.position.set(p.x - ox, p.y - oy);
      s.scale.set((r * 32) / 128, (r * 20) / 128);
      s.tint = colour;
      s.alpha = Math.min(1, strength * darkness * 1.4);
      s.visible = true;
    };
    const flick = 0.9 + Math.sin(this.time * 13) * 0.05 + Math.sin(this.time * 7.3) * 0.05;
    for (const o of sim.world.objects.values()) {
      if (o.kind === 'lamp') light(o.x + 0.5, o.y + 0.5, 30, 6, 0xffd890, 1);
      else if (o.kind === 'campfire') light(o.x + 0.5, o.y + 0.5, 6, 5 * flick, 0xff9a50, 1);
      else if (o.kind === 'radio' && Math.floor(this.time * 1.2) % 2 === 0) light(o.x + 0.5, o.y + 0.5, 60, 0.9, 0xff3020, 0.8);
      else if (o.kind === 'farmhouse') light(o.x + 4.3, o.y + 2.6, 10, 2.6, 0xffc070, 0.75);
    }
    if (sim.state.player.lantern) {
      light(sim.player.x, sim.player.y, 10, 6.5 * flick, 0xffe0a0, 1);
      light(sim.player.x, sim.player.y, 10, 2.5, 0xfff0d0, 0.6);
    }
    // Husks catch a little light: pale skin and eyes in the dark
    for (const hk of sim.night.husks) if (hk.state !== 'dead') light(hk.x, hk.y, 18, 1.1, 0x9ab0c0, 0.55);
    // A dim circle around the player so the night is never pitch black where you stand
    light(sim.player.x, sim.player.y, 8, 2.2, 0x8090b0, 0.55);
    const t = sim.trader.truck;
    if (t.state !== 'away') light(t.x + (t.dir === 0 ? 1.6 : -1.6), t.y, 6, 4, 0xfff0c0, 0.9);
    for (const fxl of this.flashes) light(fxl.x, fxl.y, 12, 7, 0xffe0a0, fxl.t * 8);
    for (let i = li; i < this.lights.length; i++) this.lights[i].visible = false;
    const ambColour = (Math.round(amb[0] * 255) << 16) | (Math.round(amb[1] * 255) << 8) | Math.round(Math.min(1, amb[2]) * 255);
    this.app.renderer.render({ container: this.lightLayer, target: this.lightRT, clear: true, clearColor: [amb[0], amb[1], Math.min(1, amb[2]), 1] });
    void ambColour;
    this.lightSprite.texture = this.lightRT;
    this.lightSprite.scale.set(this.zoom);
    // Align the light map with the world's pixel grid
    this.lightSprite.position.set(this.root.position.x % this.zoom - this.zoom, this.root.position.y % this.zoom - this.zoom);
    this.lightSprite.position.set(0, 0);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].t -= 1 / 60;
      if (this.flashes[i].t <= 0) this.flashes.splice(i, 1);
    }
  }

  private flashes: { x: number; y: number; t: number }[] = [];
  private tracerG = new Graphics();
  private tracers: { x0: number; y0: number; x1: number; y1: number; t: number }[] = [];

  muzzleFlash(x: number, y: number): void {
    this.flashes.push({ x, y, t: 0.08 });
  }

  tracer(x0: number, y0: number, x1: number, y1: number): void {
    this.tracers.push({ x0, y0, x1, y1, t: 0.09 });
    this.muzzleFlash(x0, y0);
  }

  private drawTracers(dt: number): void {
    if (!this.tracerG.parent) this.root.addChild(this.tracerG);
    this.tracerG.clear();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      const a = toScreen(t.x0, t.y0, 14);
      const b = toScreen(t.x1, t.y1, 12);
      this.tracerG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xffe8a0, width: 1, alpha: Math.min(1, t.t * 14) });
    }
  }

  private renderWeather(dt: number, W: number, H: number): void {
    const w = this.sim.state.weather;
    const raining = w === 'rain';
    for (const s of this.rain) {
      if (!raining) {
        s.visible = false;
        continue;
      }
      if (!s.visible) {
        s.visible = true;
        s.position.set(Math.random() * W, Math.random() * H);
      }
      s.y += dt * 520;
      s.x -= dt * 130;
      s.scale.set(this.zoom * 0.5, this.zoom * 0.9);
      if (s.y > H) {
        s.y = -10;
        s.x = Math.random() * (W + 200);
      }
    }
    this.dustTint.clear();
    if (w === 'dust') this.dustTint.rect(0, 0, W, H).fill({ color: 0xa07040, alpha: 0.16 });
  }
}
