// Fixed numbers the whole game shares. Tunable gameplay numbers live in data files.

/** Native pixel size of one isometric tile (2:1). Everything is drawn at native size and scaled up. */
export const TILE_W = 32;
export const TILE_H = 16;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** The valley map, in tiles. */
export const MAP_W = 96;
export const MAP_H = 96;

/** Ground is painted and uploaded in square chunks of this many tiles. */
export const CHUNK = 16;

/** Simulation step, seconds. The sim always advances in these steps. */
export const STEP = 1 / 60;

/** Real seconds per game minute. A day (06:00 to 02:00) lasts about 14 minutes. */
export const MINUTE_SEC = 0.7;

export const DAY_START = 6 * 60; // 06:00
export const DAY_END = 26 * 60; // 02:00 the next morning

export const SEASON_DAYS = 12;
export const SEASONS = ['Wet', 'Green', 'Dry', 'Cold'] as const;
export type Season = (typeof SEASONS)[number];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

declare const __VERSION__: string;
export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
