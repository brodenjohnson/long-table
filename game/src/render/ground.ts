// Ground layer: one sprite per painted chunk, painted lazily around the camera.
import { Container, Sprite, Texture } from 'pixi.js';
import { CHUNK, MAP_H, MAP_W } from '../core/config';
import { chunkOrigin, paintChunk } from '../art/ground';
import { World } from '../sim/world';

const CW = Math.ceil(MAP_W / CHUNK);
const CH = Math.ceil(MAP_H / CHUNK);

export class GroundLayer {
  readonly view = new Container();
  private sprites: (Sprite | null)[] = new Array(CW * CH).fill(null);
  private version = -1;
  private dirty = new Set<number>();

  constructor(private world: World, private seed: number) {}

  private build(c: number): void {
    const cx = c % CW;
    const cy = Math.floor(c / CW);
    const cv = paintChunk(this.world, cx, cy, this.seed);
    const tex = Texture.from(cv.canvas);
    tex.source.scaleMode = 'nearest';
    const o = chunkOrigin(cx, cy);
    const old = this.sprites[c];
    if (old) {
      old.texture.destroy(true);
      old.texture = tex;
    } else {
      const s = new Sprite(tex);
      s.position.set(o.ox, o.oy);
      this.view.addChild(s);
      this.sprites[c] = s;
    }
  }

  /** Marks the chunks holding these tiles for repainting. */
  invalidateTile(x: number, y: number): void {
    this.dirty.add(Math.floor(y / CHUNK) * CW + Math.floor(x / CHUNK));
  }

  /** Paint chunks near the view. `budget` caps how many are painted this frame. */
  update(viewTiles: { x0: number; y0: number; x1: number; y1: number }, budget = 2): void {
    if (this.version !== this.world.terrainVersion) {
      this.version = this.world.terrainVersion;
      for (let c = 0; c < CW * CH; c++) if (this.sprites[c]) this.dirty.add(c);
    }
    let left = budget;
    for (const c of this.dirty) {
      if (left <= 0) break;
      this.dirty.delete(c);
      this.build(c);
      left--;
    }
    const cx0 = Math.max(0, Math.floor(viewTiles.x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(viewTiles.y0 / CHUNK));
    const cx1 = Math.min(CW - 1, Math.floor(viewTiles.x1 / CHUNK));
    const cy1 = Math.min(CH - 1, Math.floor(viewTiles.y1 / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * CW + cx;
        if (!this.sprites[c] && left > 0) {
          this.build(c);
          left--;
        }
      }
  }

  /** Paint everything now (used at load and in tests). */
  buildAll(): void {
    for (let c = 0; c < CW * CH; c++) if (!this.sprites[c]) this.build(c);
  }
}
