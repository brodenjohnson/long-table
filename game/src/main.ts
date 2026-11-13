import { Game } from './game';

const game = new Game();
game.init().catch(e => {
  console.error(e);
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<div style="padding:2em;color:#e9dfc6;font-family:monospace">The game could not start: ${String(e?.message ?? e)}</div>`;
});
