// Electron main process: one window, saves as files in the user's app data folder.
// Steam: when there is an app id, initialise Steamworks here (for example with steamworks.js)
// and point Steam Cloud at the saves folder below. Saves are plain JSON files, one per slot.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const savesDir = () => {
  const d = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const slotFile = slot => path.join(savesDir(), `slot${Number(slot)}.json`);

ipcMain.on('save:write', (e, slot, json) => {
  const f = slotFile(slot);
  // Write to a temp file, then rename, so a crash mid-write never corrupts a save
  fs.writeFileSync(f + '.tmp', json, 'utf8');
  fs.renameSync(f + '.tmp', f);
  e.returnValue = true;
});
ipcMain.on('save:read', (e, slot) => {
  try {
    e.returnValue = fs.readFileSync(slotFile(slot), 'utf8');
  } catch {
    e.returnValue = null;
  }
});
ipcMain.on('save:remove', (e, slot) => {
  try {
    fs.unlinkSync(slotFile(slot));
  } catch {
    /* already gone */
  }
  e.returnValue = true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    title: 'Long Table',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false }
  });
  win.setMenu(null);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) win.setFullScreen(!win.isFullScreen());
  });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
