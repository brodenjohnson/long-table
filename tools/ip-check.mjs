// Fails if any name from another game turns up in the game's code, data or UI text.
// Run: node tools/ip-check.mjs   (also run by npm run ipcheck in game/)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scan = ['game/src', 'game/index.html', 'game/artview.html'];

// Whole-word, case-insensitive. Keep this list growing; see docs/PLAN.md section 3.
const BANNED = [
  'fallout', 'vault-tec', 'vault tec', 'pip-boy', 'pipboy', 'nuka', 'radaway', 'rad-away', 'rad-x', 'radx', 'stimpak', 'stimpack',
  'brahmin', 'deathclaw', 'radroach', 'mirelurk', 'super mutant', 'brotherhood of steel', 'enclave', 'v.a.t.s', 'vats', 'mentats', 'buffout',
  'bottle caps', 'pipe pistol', 'pipe rifle', 'twohead', 'two-headed', 'bloater', 'spitter', 'clicker', 'hollowclaw',
  'elder scrolls', 'tamriel', 'hammerfell', 'redguard', 'skyrim', 'skeever', 'mudcrab', 'septim', 'dovahkiin', 'daedra', 'nord',
  'stardew', 'pelican town', 'joja', 'junimo', 'cities skylines', 'transport fever', 'wasteland'
];

// Words that are fine even though they contain a banned word, or are code identifiers.
const ALLOW = [/\bnorden\b/i, /\bnordic\b/i];

function files(p) {
  const full = join(root, p);
  const st = statSync(full);
  if (st.isFile()) return [full];
  return readdirSync(full).flatMap(f => files(join(p, f)));
}

const problems = [];
for (const f of scan.flatMap(files)) {
  if (!/\.(ts|js|json|html|css|txt|md)$/.test(f)) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const word of BANNED) {
      const re = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      if (re.test(line) && !ALLOW.some(a => a.test(line))) problems.push(`${relative(root, f)}:${i + 1}: "${word}" in: ${line.trim().slice(0, 120)}`);
    }
  });
}

if (problems.length) {
  console.error(`IP check failed. ${problems.length} problem(s):\n` + problems.join('\n'));
  process.exit(1);
}
console.log('IP check passed: no banned names found.');
