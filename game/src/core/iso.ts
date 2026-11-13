import { HALF_H, HALF_W } from './config';

/** World position in tile units (x east-south, y west-south on screen) to native screen pixels. */
export function toScreen(tx: number, ty: number, z = 0): { x: number; y: number } {
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H - z };
}

/** Native screen pixels back to world tile units (on the ground plane). */
export function toTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Depth used to sort everything that stands on the ground. Larger is nearer the viewer. */
export function depthOf(tx: number, ty: number): number {
  return tx + ty;
}

/**
 * Screen directions as an index 0..7, clockwise from east: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE.
 * "Screen" means as the player sees it, so S is straight down the screen.
 */
export const DIR_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

/** Screen-space unit vector for a direction index (x right, y down). */
export function dirVector(d: number): { x: number; y: number } {
  const a = (d * Math.PI) / 4;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Direction index from a screen-space vector. */
export function dirFromScreen(x: number, y: number): number {
  const a = Math.atan2(y, x);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Convert a screen-space movement vector (x right, y down) to a tile-space vector of the same on-screen speed. */
export function screenToTileVec(x: number, y: number): { x: number; y: number } {
  // A tile step of (1,0) moves (HALF_W, HALF_H) on screen. Undo that, then normalise to screen length.
  const tx = x / HALF_W / 2 + y / HALF_H / 2;
  const ty = y / HALF_H / 2 - x / HALF_W / 2;
  return { x: tx, y: ty };
}

/** Tile-space vector to screen-space vector (pixels per tile unit). */
export function tileToScreenVec(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H };
}
