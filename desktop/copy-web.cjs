// Copies the built web game into desktop/web so Electron can load it from disk.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'game', 'dist');
const dst = path.join(__dirname, 'web');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Copied', src, 'to', dst);
