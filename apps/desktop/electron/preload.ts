import { contextBridge, ipcRenderer } from "electron";

console.log("[preload] injected");

contextBridge.exposeInMainWorld("alpha", {
  runTask: (task: string, selectorBundle?: any) =>
      ipcRenderer.invoke("agent:run", { task, selectorBundle }),
  stop:     () => ipcRenderer.invoke("agent:stop"),
  takeOver: () => ipcRenderer.invoke("agent:takeOver"),
  resume:   () => ipcRenderer.invoke("agent:resume"),
  onLog: (cb: any) => {
    const h = (_: any, p: any) => cb(p);
    ipcRenderer.on("agent:log", h);
    return () => ipcRenderer.removeListener("agent:log", h);
  },
  showInFolder: (filePath: string) => ipcRenderer.invoke("shell:showInFolder", filePath),
  hello: () => ipcRenderer.invoke("alpha:hello"),
  notifyWebviewReady: (guestId: number) => ipcRenderer.invoke("webview:ready", guestId)
});
