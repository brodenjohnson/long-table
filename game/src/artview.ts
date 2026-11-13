// Development page: shows generated art at 3x so it can be judged without playing.
import { paintCharacter, LOOKS, handLook, Anim, Tool } from './art/rig';
import { paintPropsPreview } from './art/preview';

const params = new URLSearchParams(location.search);
const show = params.get('show') ?? 'chars';
const c = document.getElementById('c') as HTMLCanvasElement;
const ctx = c.getContext('2d')!;
ctx.imageSmoothingEnabled = false;
const S = Number(params.get('scale') ?? 3);

if (show === 'chars') {
  const rows: [string, Anim, Tool, number][] = [
    ['player', 'idle', 'none', 0], ['player', 'walk', 'none', 1], ['player', 'walk', 'none', 3], ['player', 'swing', 'hoe', 0], ['player', 'swing', 'axe', 2],
    ['player', 'pour', 'can', 0], ['player', 'shoot', 'pistol', 0], ['player', 'roll', 'none', 0], ['player', 'dead', 'none', 0],
    ['husk', 'walk', 'none', 0], ['husk', 'claw', 'none', 0], ['trader', 'walk', 'none', 0], ['hand', 'walk', 'none', 0]
  ];
  c.width = 8 * 44 * S + 10;
  c.height = rows.length * 46 * S;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6b6040';
  ctx.fillRect(0, 0, c.width, c.height);
  rows.forEach(([who, anim, tool, f], r) => {
    const look = who === 'hand' ? handLook(1, 'x') : LOOKS[who];
    for (let d = 0; d < 8; d++) {
      const cv = paintCharacter(look, anim, Math.min(f, 5), d, tool);
      ctx.drawImage(cv.canvas, d * 44 * S, r * 46 * S, 44 * S, 46 * S);
    }
  });
} else {
  paintPropsPreview(c, S);
}
(window as any).__game = { ready: true };
