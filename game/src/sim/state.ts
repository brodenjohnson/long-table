// Everything that is saved. Transient things (Husks at night, particles) live in the Sim, not here.
import { DAY_START, SEASONS, SEASON_DAYS, Season, WEEKDAYS } from '../core/config';

export interface Stack {
  id: string;
  n: number;
  /** Quality 0 Fair, 1 Good, 2 Prime. Produce only. */
  q?: number;
  /** Tainted produce, grown in contaminated soil. */
  t?: 1;
}

export type WeatherKind = 'clear' | 'cloud' | 'rain' | 'dust' | 'frost';

export interface PlayerState {
  x: number;
  y: number;
  dir: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  /** Radiation and chemical dose taken on, 0..100. */
  dose: number;
  lantern: boolean;
  scrip: number;
  /** Water left in the can. */
  water: number;
}

export interface HandState {
  id: string;
  x: number;
  y: number;
  dir: number;
  morale: number;
  unpaid: number;
  daysWorked: number;
  /** Object id of the bunk they sleep in, or 0 if they sleep rough. */
  bunk: number;
  job: 'tend' | 'guard' | 'off';
  water: number;
  carrying: Stack[];
}

export interface TraderState {
  /** Demand multiplier per item id, 0.5..1.2. Selling a lot of one thing drives it down. */
  demand: Record<string, number>;
  /** Scrip paid for the last collection, for the morning report. */
  lastPaid: number;
}

export interface GameState {
  version: number;
  seed: number;
  name: string;
  day: number;
  minute: number;
  weather: WeatherKind;
  tomorrow: WeatherKind;
  player: PlayerState;
  inv: (Stack | null)[];
  sel: number;
  depot: Stack[];
  trader: TraderState;
  hands: HandState[];
  /** A drifter waiting at the gate to be hired, and the day they turned up. */
  applicant: { id: string; day: number } | null;
  /** Hands who have left or been let go do not come back. */
  goneHands: string[];
  flags: Record<string, boolean | number | string>;
  /** The Sallow Crew: when they ask, what they asked, and what you did. */
  crew: { envoyDay: number; demand: number; paidUntil: number; raidDay: number; angry: number; won: number; lost: number };
  stats: { earned: number; harvested: number; husks: number; shipped: number };
  /** The morning report, shown once after waking. */
  report: string[];
  journal: { day: number; text: string }[];
}

export const SAVE_VERSION = 2;
export const INV_SIZE = 30;
export const HOTBAR = 10;

export function seasonOf(day: number): Season {
  return SEASONS[Math.floor((day - 1) / SEASON_DAYS) % 4];
}

export function dayOfSeason(day: number): number {
  return ((day - 1) % SEASON_DAYS) + 1;
}

export function weekday(day: number): string {
  return WEEKDAYS[(day - 1) % 7];
}

export function weekdayIndex(day: number): number {
  return (day - 1) % 7;
}

export function yearOf(day: number): number {
  return Math.floor((day - 1) / (SEASON_DAYS * 4)) + 1;
}

export function newGameState(seed: number, name: string, startX: number, startY: number): GameState {
  const inv: (Stack | null)[] = new Array(INV_SIZE).fill(null);
  const start: Stack[] = [
    { id: 'hoe', n: 1 },
    { id: 'can', n: 1 },
    { id: 'axe', n: 1 },
    { id: 'pick', n: 1 },
    { id: 'machete', n: 1 },
    { id: 'radish_seed', n: 15 },
    { id: 'potato_seed', n: 6 },
    { id: 'pistol', n: 1 },
    { id: 'tinned_beans', n: 3 },
    { id: 'bandage', n: 2 },
    { id: 'rounds', n: 8 },
    { id: 'sunflower_seed', n: 4 }
  ];
  start.forEach((s, i) => (inv[i] = s));
  return {
    version: SAVE_VERSION,
    seed,
    name,
    day: 1,
    minute: DAY_START,
    weather: 'clear',
    tomorrow: 'cloud',
    player: { x: startX, y: startY, dir: 2, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, dose: 0, lantern: false, scrip: 60, water: 20 },
    inv,
    sel: 0,
    depot: [],
    trader: { demand: {}, lastPaid: 0 },
    hands: [],
    applicant: null,
    goneHands: [],
    flags: {},
    crew: { envoyDay: 0, demand: 0, paidUntil: 0, raidDay: 0, angry: 0, won: 0, lost: 0 },
    stats: { earned: 0, harvested: 0, husks: 0, shipped: 0 },
    report: [],
    journal: []
  };
}

export function timeString(minute: number): string {
  const m = Math.floor(minute) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm - (mm % 10)).padStart(2, '0')}`;
}
