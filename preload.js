const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  onProgress: cb => ipcRenderer.on('progress', (_, d) => cb(d)),
});
