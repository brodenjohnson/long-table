// Typed access to the content files. Content is data; code reads it here and nowhere else.
import cropsJson from './crops.json';
import itemsJson from './items.json';
import objectsJson from './objects.json';
import recipesJson from './recipes.json';
import enemiesJson from './enemies.json';
import peopleJson from './people.json';
import documentsJson from './documents.json';
import type { Season } from '../core/config';

export interface CropDef {
  id: string;
  name: string;
  days: number;
  regrow: number;
  seasons: Season[];
  yield: [number, number];
  sell: number;
  shape: 'root' | 'bush' | 'leafy' | 'vine' | 'stalk' | 'flower' | 'gourd';
  leaf: string;
  fruit: string;
  food: number;
  hardy?: boolean;
  cleans?: number;
}

export type ItemKind = 'tool' | 'weapon' | 'seed' | 'produce' | 'material' | 'food' | 'medicine' | 'ammo' | 'place' | 'animal';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc?: string;
  crop?: string;
  price?: number;
  sell?: number;
  stamina?: number;
  health?: number;
  dose?: number;
  place?: string;
  dmg?: number;
  reach?: number;
  arc?: number;
  cool?: number;
  stam?: number;
  range?: number;
  ammo?: string;
}

export interface ObjectDef {
  id: string;
  name: string;
  solid: boolean;
  hp: number;
  w: number;
  h: number;
  tool?: 'axe' | 'pick' | 'any';
  drops?: [string, number, number][];
  interact?: 'sleep' | 'water' | 'depot' | 'radio' | 'compost' | 'read' | 'coop';
  placed?: boolean;
  light?: number;
  husksBreak?: boolean;
  gate?: boolean;
  alsoWeapon?: boolean;
}

export interface Recipe {
  out: string;
  n: number;
  in: Record<string, number>;
  /** Where it must be made: 'fire' means within reach of the campfire. */
  at?: 'fire';
}

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  lunge: number;
  dmg: number;
  reach: number;
  windup: number;
  cool: number;
  sight: number;
  lampSight: number;
  breakDmg: number;
}

export interface HandDef {
  id: string;
  name: string;
  pitch: string;
  wage: number;
  water: number;
  harvest: number;
  nerve: number;
  secret: string;
}

function keyed<T>(src: Record<string, object>, defaults: Partial<T> = {}): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, v] of Object.entries(src)) out[id] = { ...defaults, ...v, id } as T;
  return out;
}

export const CROPS = keyed<CropDef>(cropsJson as Record<string, object>);
export const ITEMS = keyed<ItemDef>(itemsJson as Record<string, object>);
export const OBJECTS = keyed<ObjectDef>(objectsJson as Record<string, object>, { w: 1, h: 1 });
export const RECIPES = recipesJson as unknown as Recipe[];
export const ENEMIES = enemiesJson as unknown as Record<string, EnemyDef>;
export const HANDS = (peopleJson as unknown as { hands: HandDef[] }).hands;
export const TRADER = (peopleJson as unknown as { trader: { name: string; outfit: string } }).trader;
export const DOCUMENTS = documentsJson as Record<string, { title: string; text: string[] }>;
export const CREW = (peopleJson as unknown as { crew: { name: string; envoy: string } }).crew;

/** Sell price of produce, before quality, contamination and demand. */
export function baseSell(itemId: string): number {
  const it = ITEMS[itemId];
  if (!it) return 0;
  if (it.kind === 'produce' && it.crop) return CROPS[it.crop].sell;
  return it.sell ?? 0;
}

export const QUALITY_NAMES = ['Fair', 'Good', 'Prime'] as const;
export const QUALITY_MULT = [1, 1.3, 1.7];
export const TAINT_MULT = 0.45;

/** Checks that cross-references between files are sound. Throws with every problem found. */
export function validateData(): void {
  const errs: string[] = [];
  for (const it of Object.values(ITEMS)) {
    if (it.crop && !CROPS[it.crop]) errs.push(`item ${it.id}: unknown crop ${it.crop}`);
    if (it.place && !OBJECTS[it.place]) errs.push(`item ${it.id}: unknown object ${it.place}`);
    if (it.ammo && !ITEMS[it.ammo]) errs.push(`item ${it.id}: unknown ammo ${it.ammo}`);
  }
  for (const c of Object.values(CROPS)) {
    if (!ITEMS[c.id]) errs.push(`crop ${c.id}: no produce item`);
    if (!ITEMS[c.id + '_seed']) errs.push(`crop ${c.id}: no seed item`);
  }
  for (const o of Object.values(OBJECTS)) for (const d of o.drops ?? []) if (!ITEMS[d[0]]) errs.push(`object ${o.id}: unknown drop ${d[0]}`);
  for (const r of RECIPES) {
    if (!ITEMS[r.out]) errs.push(`recipe: unknown output ${r.out}`);
    for (const k of Object.keys(r.in)) if (!ITEMS[k]) errs.push(`recipe ${r.out}: unknown input ${k}`);
  }
  if (errs.length) throw new Error('Data errors:\n' + errs.join('\n'));
}
