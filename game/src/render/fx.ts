// Particles and ground decals. Pure presentation; the sim only asks for them through events.
import { Container, Sprite, Texture } from 'pixi.js';
import { toScreen } from '../core/iso';
import { Atlas } from '../art/atlas';

interface Particle {
  s: Sprite;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  life: number;
  max: number;
  drag: number;
  fade: boolean;
}

const MAX = 600;

export class Fx {
  readonly view = new Container();
  readonly decals = new Container();
  private parts: Particle[] = [];
  private pool: Sprite[] = [];
  private decalList: { s: Sprite; age: number }[] = [];
  gore: 'full' | 'reduced' | 'off' = 'full';

  constructor(private atlas: Atlas) {}

  private sprite(tex: Texture): Sprite {
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.alpha = 1;
    s.scale.set(1);
    s.tint = 0xffffff;
    s.visible = true;
    this.view.addChild(s);
    return s;
  }

  /** Spawn particles at a world tile position. */
  burst(kind: string, wx: number, wy: number, z = 0, n = 6, dx = 0, dy = 0): void {
    if (kind === 'blood' && this.gore === 'off') kind = 'dust';
    if (kind === 'blood' && this.gore === 'reduced') n = Math.ceil(n / 3);
    const p = toScreen(wx, wy);
    for (let i = 0; i < n && this.parts.length < MAX; i++) {
      let tex = 'p:dust';
      let vx = (Math.random() - 0.5) * 30;
      let vy = (Math.random() - 0.5) * 14;
      let vz = 20 + Math.random() * 30;
      let g = 120;
      let life = 0.5 + Math.random() * 0.4;
      let drag = 0.92;
      let fade = true;
      switch (kind) {
        case 'dust':
          tex = 'p:dust';
          vz = 6 + Math.random() * 10;
          g = 10;
          vx *= 0.5;
          vy *= 0.5;
          life = 0.4 + Math.random() * 0.4;
          break;
        case 'soil':
          tex = 'p:soil';
          vz = 25 + Math.random() * 25;
          break;
        case 'water':
        case 'splash':
          tex = 'p:water';
          vz = 20 + Math.random() * 20;
          vx *= 0.6;
          vy *= 0.6;
          break;
        case 'chip':
          tex = 'p:chip';
          vz = 30 + Math.random() * 30;
          vx *= 1.4;
          break;
        case 'stone':
          tex = 'p:stone';
          vz = 25 + Math.random() * 25;
          break;
        case 'leaf':
          tex = 'p:leaf';
          vz = 25 + Math.random() * 20;
          g = 50;
          life = 0.8;
          break;
        case 'spark':
          tex = 'p:spark';
          vx *= 2;
          vy *= 2;
          vz = 30 + Math.random() * 40;
          life = 0.25 + Math.random() * 0.2;
          break;
        case 'blood':
          tex = 'p:blood';
          vx = vx * 1.2 + (dx - dy) * 40;
          vy = vy * 1.2 + (dx + dy) * 20;
          vz = 25 + Math.random() * 30;
          life = 0.7;
          fade = false;
          break;
        case 'muzzle':
          tex = 'p:spark';
          vx = 0;
          vy = 0;
          vz = 0;
          g = 0;
          life = 0.06;
          break;
        case 'ember':
          tex = 'p:spark';
          vx = (Math.random() - 0.5) * 6;
          vy = 0;
          vz = 12 + Math.random() * 10;
          g = -4;
          life = 0.9 + Math.random() * 0.6;
          drag = 0.98;
          break;
        case 'smoke':
          tex = 'p:dust';
          vx = 4 + Math.random() * 3;
          vy = -1;
          vz = 10 + Math.random() * 4;
          g = -2;
          life = 2.4;
          drag = 0.99;
          break;
        case 'sparkle':
          tex = 'p:white';
          vx = 0;
          vy = 0;
          vz = 0;
          g = 0;
          life = 0.35;
          break;
        case 'firefly':
          tex = 'p:spark';
          vx = (Math.random() - 0.5) * 8;
          vy = (Math.random() - 0.5) * 4;
          vz = 2;
          g = 0;
          life = 2.5;
          drag = 0.995;
          break;
      }
      const s = this.sprite(this.atlas.get(tex));
      if (kind === 'muzzle') s.scale.set(4);
      if (kind === 'smoke') {
        s.scale.set(2);
        s.alpha = 0.5;
        s.tint = 0x9a9590;
      }
      this.parts.push({ s, x: p.x, y: p.y, z, vx, vy, vz, g, life, max: life, drag, fade });
    }
  }

  decal(kind: string, wx: number, wy: number): void {
    if (this.gore === 'off') return;
    const p = toScreen(wx, wy);
    const s = new Sprite(this.atlas.get(`splat:${Math.floor(Math.random() * 4)}`));
    s.position.set(Math.round(p.x), Math.round(p.y));
    s.alpha = this.gore === 'reduced' ? 0.5 : 0.85;
    this.decals.addChild(s);
    this.decalList.push({ s, age: 0 });
    if (this.decalList.length > 90) {
      const old = this.decalList.shift()!;
      old.s.destroy();
    }
    void kind;
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= dt;
      if (q.life <= 0) {
        q.s.visible = false;
        this.view.removeChild(q.s);
        this.pool.push(q.s);
        this.parts.splice(i, 1);
        continue;
      }
      q.vz -= q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.vx *= q.drag;
      q.vy *= q.drag;
      if (q.z < 0) {
        q.z = 0;
        q.vz = 0;
        q.vx *= 0.5;
        q.vy *= 0.5;
      }
      q.s.position.set(Math.round(q.x), Math.round(q.y - q.z));
      if (q.fade) q.s.alpha = Math.min(1, (q.life / q.max) * 2) * (q.s.tint === 0x9a9590 ? 0.45 : 1);
    }
    for (let i = this.decalList.length - 1; i >= 0; i--) {
      const d = this.decalList[i];
      d.age += dt;
      if (d.age > 90) {
        d.s.alpha -= dt * 0.2;
        if (d.s.alpha <= 0) {
          d.s.destroy();
          this.decalList.splice(i, 1);
        }
      }
    }
  }

  clearDecals(): void {
    for (const d of this.decalList) d.s.destroy();
    this.decalList = [];
  }
}
