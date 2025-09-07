"use strict";

// electron/preload.ts
var import_electron = require("electron");
console.log("[preload] injected");
import_electron.contextBridge.exposeInMainWorld("alpha", {
  runTask: (task, selectorBundle) => import_electron.ipcRenderer.invoke("agent:run", { task, selectorBundle }),
  stop: () => import_electron.ipcRenderer.invoke("agent:stop"),
  takeOver: () => import_electron.ipcRenderer.invoke("agent:takeOver"),
  resume: () => import_electron.ipcRenderer.invoke("agent:resume"),
  onLog: (cb) => {
    const h = (_, p) => cb(p);
    import_electron.ipcRenderer.on("agent:log", h);
    return () => import_electron.ipcRenderer.removeListener("agent:log", h);
  },
  showInFolder: (filePath) => import_electron.ipcRenderer.invoke("shell:showInFolder", filePath),
  hello: () => import_electron.ipcRenderer.invoke("alpha:hello")
});
//# sourceMappingURL=preload.js.map
