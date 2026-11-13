// Inventory helpers. Stacks merge when id, quality and taint match.
import { ITEMS } from '../data';
import type { Stack } from './state';

export const STACK_MAX = 99;

export function stackable(id: string): boolean {
  const k = ITEMS[id]?.kind;
  return k !== 'tool' && k !== 'weapon';
}

export function sameKind(a: Stack, b: Stack): boolean {
  return a.id === b.id && (a.q ?? 0) === (b.q ?? 0) && (a.t ?? 0) === (b.t ?? 0);
}

/** Adds as much as fits. Returns how many did not fit. */
export function addItem(inv: (Stack | null)[], s: Stack): number {
  let left = s.n;
  if (stackable(s.id)) {
    for (const slot of inv) {
      if (!slot || !sameKind(slot, s) || slot.n >= STACK_MAX) continue;
      const room = STACK_MAX - slot.n;
      const k = Math.min(room, left);
      slot.n += k;
      left -= k;
      if (!left) return 0;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (inv[i]) continue;
    const k = stackable(s.id) ? Math.min(STACK_MAX, left) : 1;
    inv[i] = { ...s, n: k };
    left -= k;
  }
  return left;
}

export function countItem(inv: (Stack | null)[], id: string): number {
  let n = 0;
  for (const s of inv) if (s && s.id === id) n += s.n;
  return n;
}

/** Removes n of an item (any quality). Returns false and removes nothing if there are not enough. */
export function removeItem(inv: (Stack | null)[], id: string, n: number): boolean {
  if (countItem(inv, id) < n) return false;
  let left = n;
  // Take lowest quality first
  const order = inv.map((s, i) => ({ s, i })).filter(e => e.s && e.s.id === id).sort((a, b) => (a.s!.q ?? 0) - (b.s!.q ?? 0));
  for (const { s, i } of order) {
    const k = Math.min(s!.n, left);
    s!.n -= k;
    left -= k;
    if (s!.n <= 0) inv[i] = null;
    if (!left) break;
  }
  return true;
}

export function removeFromSlot(inv: (Stack | null)[], i: number, n = 1): void {
  const s = inv[i];
  if (!s) return;
  s.n -= n;
  if (s.n <= 0) inv[i] = null;
}

export function hasRoomFor(inv: (Stack | null)[], s: Stack): boolean {
  const copy = inv.map(x => (x ? { ...x } : null));
  return addItem(copy, s) === 0;
}
