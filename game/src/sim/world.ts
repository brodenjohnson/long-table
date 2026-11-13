// The valley: terrain, soil, objects and crops. Plain data plus small helpers. No drawing code.
import { MAP_H, MAP_W } from '../core/config';
import { OBJECTS, ObjectDef } from '../data';

export enum T {
  Grass = 0,
  Dry = 1,
  Dirt = 2,
  Road = 3,
  Water = 4,
  Deep = 5,
  Ash = 6,
  Concrete = 7,
  Sand = 8,
  Track = 9
}

export interface WObject {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  /** Variant for art (0..n). */
  v: number;
  /** Per-object state, e.g. compost bin contents, rain barrel water. */
  s?: Record<string, number | string>;
}

export interface Crop {
  kind: string;
  /** Days of growth so far. */
  age: number;
  /** Watered today (by hand, rain or sprinkler). */
  wet: boolean;
  /** Days in a row without water. */
  dry: number;
  /** Ready to pick. */
  ripe: boolean;
  /** Days until it fruits again, for regrowing crops that have been picked. */
  regrowIn: number;
  /** Has been picked at least once (regrowing crops). */
  picked: boolean;
  /** Days it was watered, for quality. */
  care: number;
  dead: boolean;
}

export function idx(x: number, y: number): number {
  return y * MAP_W + x;
}

export function inMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

export class World {
  readonly terrain = new Uint8Array(MAP_W * MAP_H);
  /** Contamination 0..1. Changes as land is cleaned. */
  readonly contam = new Float32Array(MAP_W * MAP_H);
  /** Fertility 0..1. Compost raises it, cropping lowers it a little. */
  readonly fert = new Float32Array(MAP_W * MAP_H);
  /** Days since tilled (0 = not tilled). */
  readonly tilled = new Uint8Array(MAP_W * MAP_H);
  /** Soil watered today. */
  readonly wet = new Uint8Array(MAP_W * MAP_H);
  /** Object id occupying each tile, 0 for none. */
  readonly objAt = new Int32Array(MAP_W * MAP_H);
  readonly objects = new Map<number, WObject>();
  readonly crops = new Map<number, Crop>();
  nextId = 1;
  /** Bumped whenever terrain changes, so the renderer can repaint ground. */
  terrainVersion = 0;

  def(o: WObject): ObjectDef {
    return OBJECTS[o.kind];
  }

  objectAt(x: number, y: number): WObject | undefined {
    if (!inMap(x, y)) return undefined;
    const id = this.objAt[idx(x, y)];
    return id ? this.objects.get(id) : undefined;
  }

  canPlace(kind: string, x: number, y: number): boolean {
    const d = OBJECTS[kind];
    for (let j = 0; j < d.h; j++)
      for (let i = 0; i < d.w; i++) {
        const tx = x + i;
        const ty = y + j;
        if (!inMap(tx, ty) || tx < 1 || ty < 1 || tx > MAP_W - 2 || ty > MAP_H - 2) return false;
        const k = idx(tx, ty);
        if (this.objAt[k]) return false;
        const t = this.terrain[k];
        if (t === T.Water || t === T.Deep) return false;
        if (this.crops.has(k)) return false;
      }
    return true;
  }

  add(kind: string, x: number, y: number, v = 0, s?: WObject['s']): WObject {
    const d = OBJECTS[kind];
    const o: WObject = { id: this.nextId++, kind, x, y, hp: d.hp, v, s };
    this.objects.set(o.id, o);
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) this.objAt[idx(x + i, y + j)] = o.id;
    return o;
  }

  remove(o: WObject): void {
    const d = OBJECTS[o.kind];
    this.objects.delete(o.id);
    for (let j = 0; j < d.h; j++)
      for (let i = 0; i < d.w; i++) {
        const k = idx(o.x + i, o.y + j);
        if (this.objAt[k] === o.id) this.objAt[k] = 0;
      }
  }

  isWater(x: number, y: number): boolean {
    if (!inMap(x, y)) return false;
    const t = this.terrain[idx(x, y)];
    return t === T.Water || t === T.Deep;
  }

  /** Can something walk onto this tile? Gates let friendly walkers through. */
  walkable(x: number, y: number, friendly: boolean): boolean {
    if (!inMap(x, y) || x < 1 || y < 1 || x > MAP_W - 2 || y > MAP_H - 2) return false;
    const k = idx(x, y);
    if (this.terrain[k] === T.Deep) return false;
    const id = this.objAt[k];
    if (!id) return true;
    const o = this.objects.get(id)!;
    const d = OBJECTS[o.kind];
    if (!d.solid) return true;
    if (d.gate && friendly) return true;
    return false;
  }
}
