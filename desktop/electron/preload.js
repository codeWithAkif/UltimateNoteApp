const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
});
