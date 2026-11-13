// Keyboard, mouse and controller, mapped to actions. Bindings are rebindable and saved in settings.

export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'use' | 'interact' | 'dodge' | 'lantern'
  | 'inventory' | 'craft' | 'journal' | 'pause'
  | 'hot1' | 'hot2' | 'hot3' | 'hot4' | 'hot5' | 'hot6' | 'hot7' | 'hot8' | 'hot9' | 'hot10'
  | 'next' | 'prev' | 'zoomIn' | 'zoomOut';

export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  use: [],
  interact: ['KeyE'],
  dodge: ['Space'],
  lantern: ['KeyF'],
  inventory: ['Tab', 'KeyI'],
  craft: ['KeyC'],
  journal: ['KeyJ'],
  pause: ['Escape'],
  hot1: ['Digit1'], hot2: ['Digit2'], hot3: ['Digit3'], hot4: ['Digit4'], hot5: ['Digit5'],
  hot6: ['Digit6'], hot7: ['Digit7'], hot8: ['Digit8'], hot9: ['Digit9'], hot10: ['Digit0'],
  next: ['KeyX'],
  prev: ['KeyZ'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract']
};

export const ACTION_LABELS: Partial<Record<Action, string>> = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', interact: 'Interact, harvest, talk',
  dodge: 'Dodge roll', lantern: 'Lantern', inventory: 'Bag', craft: 'Make things', journal: 'Journal', pause: 'Menu',
  next: 'Next item', prev: 'Previous item', zoomIn: 'Zoom in', zoomOut: 'Zoom out'
};

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class Input {
  keys: Record<Action, string[]> = structuredClone(DEFAULT_KEYS);
  private down = new Set<string>();
  private pressedKeys = new Set<string>();
  mouse = { x: 0, y: 0, inside: false, moved: false };
  private mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  private wheel = 0;
  /** Set by the UI while a menu has focus. */
  blockWorld = false;
  /** The last device used, so prompts can show the right buttons. */
  device: 'keyboard' | 'pad' = 'keyboard';
  private padPrev: boolean[] = [];
  private padPressed = new Set<number>();
  padMove = { x: 0, y: 0 };
  padAim = { x: 0, y: 0 };
  private padDown = new Set<number>();
  /** Fires for every key press, for rebinding. */
  onAnyKey: ((code: string) => boolean) | null = null;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (this.onAnyKey && this.onAnyKey(e.code)) {
        e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedKeys.add(e.code);
      this.down.add(e.code);
      this.device = 'keyboard';
    });
    window.addEventListener('keyup', e => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown = [false, false, false];
    });
    canvas.addEventListener('mousedown', e => {
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
      this.device = 'keyboard';
    });
    window.addEventListener('mouseup', e => (this.mouseDown[e.button] = false));
    window.addEventListener('mousemove', e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
      this.mouse.moved = true;
    });
    canvas.addEventListener('mouseleave', () => (this.mouse.inside = false));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  setKeys(k: Partial<Record<Action, string[]>>): void {
    this.keys = { ...structuredClone(DEFAULT_KEYS), ...k };
  }

  held(a: Action): boolean {
    return this.keys[a].some(k => this.down.has(k));
  }

  /** True once per key press. Consumed by `endFrame`. */
  pressed(a: Action): boolean {
    if (this.keys[a].some(k => this.pressedKeys.has(k))) return true;
    switch (a) {
      case 'inventory': return this.padPressed.has(PAD.Y);
      case 'pause': return this.padPressed.has(PAD.START);
      case 'next': return this.padPressed.has(PAD.RB) || this.padPressed.has(PAD.RIGHT);
      case 'prev': return this.padPressed.has(PAD.LB) || this.padPressed.has(PAD.LEFT);
      case 'lantern': return this.padPressed.has(PAD.UP);
      case 'journal': return this.padPressed.has(PAD.BACK);
      case 'craft': return this.padPressed.has(PAD.DOWN);
    }
    return false;
  }

  /** Controller buttons for menus. */
  padButton(name: keyof typeof PAD): boolean {
    return this.padPressed.has(PAD[name]);
  }

  mouseHeld(b: number): boolean {
    return this.mouseDown[b] && !this.blockWorld;
  }

  mouseClicked(b: number): boolean {
    return this.mousePressed[b] && !this.blockWorld;
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  pollPad(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = Array.from(pads).find(x => x && x.connected);
    this.padPressed.clear();
    if (!p) {
      this.padMove = { x: 0, y: 0 };
      this.padAim = { x: 0, y: 0 };
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : (v - Math.sign(v) * 0.2) / 0.8);
    this.padMove = { x: dz(p.axes[0] ?? 0), y: dz(p.axes[1] ?? 0) };
    this.padAim = { x: dz(p.axes[2] ?? 0), y: dz(p.axes[3] ?? 0) };
    const now = p.buttons.map(b => b.pressed);
    now.forEach((b, i) => {
      if (b && !this.padPrev[i]) this.padPressed.add(i);
      if (b) this.padDown.add(i);
      else this.padDown.delete(i);
    });
    if (now.some(Boolean) || Math.abs(this.padMove.x) + Math.abs(this.padMove.y) > 0) this.device = 'pad';
    this.padPrev = now;
  }

  padHeld(name: keyof typeof PAD): boolean {
    return this.padDown.has(PAD[name]);
  }

  moveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (!this.blockWorld) {
      if (this.held('left')) x -= 1;
      if (this.held('right')) x += 1;
      if (this.held('up')) y -= 1;
      if (this.held('down')) y += 1;
      x += this.padMove.x;
      y += this.padMove.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  endFrame(): void {
    this.pressedKeys.clear();
    this.mousePressed = [false, false, false];
    this.mouse.moved = false;
  }
}

export { PAD };
