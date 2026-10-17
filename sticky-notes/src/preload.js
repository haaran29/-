const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fusen', {
  get: () => ipcRenderer.invoke('note:get'),
  update: (patch) => ipcRenderer.send('note:update', patch),
  newNote: () => ipcRenderer.send('note:new'),
  remove: () => ipcRenderer.send('note:delete'),
  togglePin: () => ipcRenderer.invoke('note:togglePin'),
});
