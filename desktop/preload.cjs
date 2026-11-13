// Exposes a small, safe API to the game page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  saves: {
    write: (slot, json) => ipcRenderer.sendSync('save:write', slot, json),
    read: slot => ipcRenderer.sendSync('save:read', slot),
    remove: slot => ipcRenderer.sendSync('save:remove', slot)
  }
});
