// Development helper: lays out every atlas texture on one canvas.
import { Atlas } from './atlas';
import { paintProps } from './props';

export function paintPropsPreview(c: HTMLCanvasElement, S: number): void {
  const atlas = new Atlas();
  paintProps(atlas);
  atlas.build();
  const page = atlas.canvases[0];
  // Crop to the used area
  const ctx0 = page.getContext('2d')!;
  const data = ctx0.getImageData(0, 0, page.width, page.height).data;
  let maxY = 0;
  for (let y = page.height - 1; y >= 0 && !maxY; y--)
    for (let x = 0; x < page.width; x += 4) if (data[(y * page.width + x) * 4 + 3]) { maxY = y; break; }
  const w = 900;
  c.width = w * S;
  c.height = (maxY + 4) * S;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6b6040';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(page, 0, 0, w, maxY + 4, 0, 0, w * S, (maxY + 4) * S);
}
