// Saves: a versioned snapshot of the game state and the parts of the world that change.
// Old saves are brought up to date by the migrations list, one version at a time.
import { MAP_H, MAP_W } from '../core/config';
import { GameState, SAVE_VERSION } from './state';
import { Crop, World } from './world';
import { generate } from './worldgen';

export interface SaveFile {
  version: number;
  savedAt: number;
  build: string;
  state: GameState;
  world: {
    contam: string;
    fert: string;
    tilled: string;
    wet: string;
    nextId: number;
    objects: [number, string, number, number, number, number, Record<string, number | string> | null][];
    crops: [number, string, number, number, number, number, number, number, number, number][];
  };
}

/** Each entry upgrades a save from version i+1 to i+2. Never remove entries. */
const MIGRATIONS: ((s: SaveFile) => void)[] = [
  // 1 -> 2: the Sallow Crew
  s => {
    (s.state as GameState).crew = { envoyDay: 0, demand: 0, paidUntil: 0, raidDay: 0, angry: 0, won: 0, lost: 0 };
  },
  // 2 -> 3: hens
  s => {
    (s.state as GameState).hens = [];
    (s.state as GameState).nextHen = 1;
  }
];

function b64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function packFloat(a: Float32Array): string {
  const u = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) u[i] = Math.round(Math.max(0, Math.min(1, a[i])) * 255);
  return b64(u);
}

function unpackFloat(s: string, into: Float32Array): void {
  const u = unb64(s);
  for (let i = 0; i < into.length && i < u.length; i++) into[i] = u[i] / 255;
}

export function serialize(state: GameState, world: World, build: string): SaveFile {
  const objects: SaveFile['world']['objects'] = [];
  for (const o of world.objects.values()) objects.push([o.id, o.kind, o.x, o.y, o.hp, o.v, o.s ?? null]);
  const crops: SaveFile['world']['crops'] = [];
  for (const [k, c] of world.crops)
    crops.push([k, c.kind, c.age, c.wet ? 1 : 0, c.dry, c.ripe ? 1 : 0, c.regrowIn, c.picked ? 1 : 0, c.care, c.dead ? 1 : 0]);
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    build,
    state: JSON.parse(JSON.stringify(state)),
    world: {
      contam: packFloat(world.contam),
      fert: packFloat(world.fert),
      tilled: b64(world.tilled),
      wet: b64(world.wet),
      nextId: world.nextId,
      objects,
      crops
    }
  };
}

export function migrate(save: SaveFile): SaveFile {
  if (save.version > SAVE_VERSION) throw new Error(`This save is from a newer build (save version ${save.version}). Update the game to load it.`);
  while (save.version < SAVE_VERSION) {
    MIGRATIONS[save.version - 1](save);
    save.version++;
  }
  return save;
}

/** Rebuilds the world from its seed, then applies the saved changes. */
export function deserialize(raw: SaveFile): { state: GameState; world: World } {
  const save = migrate(raw);
  const world = new World();
  generate(world, save.state.seed);
  unpackFloat(save.world.contam, world.contam);
  unpackFloat(save.world.fert, world.fert);
  world.tilled.set(unb64(save.world.tilled).subarray(0, MAP_W * MAP_H));
  world.wet.set(unb64(save.world.wet).subarray(0, MAP_W * MAP_H));
  // Replace generated objects with the saved set
  for (const o of [...world.objects.values()]) world.remove(o);
  world.nextId = 1;
  for (const [id, kind, x, y, hp, v, s] of save.world.objects) {
    world.objects.set(id, { id, kind, x, y, hp, v, s: s ?? undefined });
  }
  // Rebuild the tile index
  world.objAt.fill(0);
  for (const o of world.objects.values()) {
    const d = world.def(o);
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) world.objAt[(o.y + j) * MAP_W + o.x + i] = o.id;
  }
  world.nextId = save.world.nextId;
  for (const [k, kind, age, wet, dry, ripe, regrowIn, picked, care, dead] of save.world.crops) {
    const c: Crop = { kind, age, wet: !!wet, dry, ripe: !!ripe, regrowIn, picked: !!picked, care, dead: !!dead };
    world.crops.set(k, c);
  }
  world.terrainVersion++;
  return { state: save.state, world };
}

// ------------------------------------------------------------------ storage

export interface SlotInfo {
  slot: number;
  name: string;
  day: number;
  savedAt: number;
  scrip: number;
}

export interface SaveStore {
  write(slot: number, data: SaveFile): void;
  read(slot: number): SaveFile | null;
  list(): SlotInfo[];
  remove(slot: number): void;
}

export const SLOTS = 3;
const KEY = (s: number) => `longtable.save.${s}`;

export class LocalStore implements SaveStore {
  write(slot: number, data: SaveFile): void {
    localStorage.setItem(KEY(slot), JSON.stringify(data));
  }

  read(slot: number): SaveFile | null {
    try {
      const raw = localStorage.getItem(KEY(slot));
      return raw ? (JSON.parse(raw) as SaveFile) : null;
    } catch {
      return null;
    }
  }

  list(): SlotInfo[] {
    const out: SlotInfo[] = [];
    for (let s = 0; s < SLOTS; s++) {
      const f = this.read(s);
      if (f) out.push({ slot: s, name: f.state.name, day: f.state.day, savedAt: f.savedAt, scrip: f.state.player.scrip });
    }
    return out;
  }

  remove(slot: number): void {
    localStorage.removeItem(KEY(slot));
  }
}

interface DesktopBridge {
  saves: { write(slot: number, json: string): boolean; read(slot: number): string | null; remove(slot: number): boolean };
}

/** Saves as files on disk, through the Electron preload bridge. Used by the Steam build. */
export class DesktopStore implements SaveStore {
  constructor(private bridge: DesktopBridge) {}

  write(slot: number, data: SaveFile): void {
    this.bridge.saves.write(slot, JSON.stringify(data));
  }

  read(slot: number): SaveFile | null {
    const raw = this.bridge.saves.read(slot);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SaveFile;
    } catch {
      return null;
    }
  }

  list(): SlotInfo[] {
    const out: SlotInfo[] = [];
    for (let s = 0; s < SLOTS; s++) {
      const f = this.read(s);
      if (f) out.push({ slot: s, name: f.state.name, day: f.state.day, savedAt: f.savedAt, scrip: f.state.player.scrip });
    }
    return out;
  }

  remove(slot: number): void {
    this.bridge.saves.remove(slot);
  }
}

/** The right store for where the game is running. */
export function makeStore(): SaveStore {
  const d = (globalThis as unknown as { desktop?: DesktopBridge }).desktop;
  return d ? new DesktopStore(d) : new LocalStore();
}
