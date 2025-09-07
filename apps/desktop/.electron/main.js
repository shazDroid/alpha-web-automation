"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_electron = require("electron");
var import_node_worker_threads = require("node:worker_threads");
var import_node_crypto = __toESM(require("node:crypto"));
var win = null;
var worker = null;
var activeRunId = null;
function sendLog(obj) {
  win?.webContents.send("agent:log", {
    runId: obj.runId ?? activeRunId ?? "default",
    level: obj.level ?? "info",
    msg: obj.msg,
    at: Date.now()
  });
}
var exists = (p) => {
  try {
    return import_node_fs.default.existsSync(p);
  } catch {
    return false;
  }
};
function agentBaseDir() {
  const candidates = [
    import_node_path.default.resolve(import_electron.app.getAppPath(), "..", "packages", "agent"),
    import_node_path.default.resolve(__dirname, "..", "..", "..", "packages", "agent"),
    import_node_path.default.resolve(process.cwd(), "..", "packages", "agent")
  ];
  for (const p of candidates) if (exists(p)) return p;
  throw new Error(
    `Could not locate packages/agent. Tried:
${candidates.map((p) => " - " + p).join("\n")}`
  );
}
function resolveWorkerEntrypoint() {
  const base = agentBaseDir();
  const distWorker = import_node_path.default.join(base, "dist", "worker.js");
  const distRun = import_node_path.default.join(base, "dist", "run.js");
  const srcWorker = import_node_path.default.join(base, "src", "worker.ts");
  if (import_node_fs.default.existsSync(distWorker) && import_node_fs.default.existsSync(distRun)) {
    return { entry: distWorker };
  }
  if (import_node_fs.default.existsSync(srcWorker)) {
    return { entry: srcWorker, execArgv: ["--loader", "ts-node/esm"] };
  }
  throw new Error(`Agent worker entry not found:
  - ${distWorker}
  - ${distRun}
  - ${srcWorker}`);
}
function ensureWorker() {
  if (worker && worker.threadId) return worker;
  const { entry, execArgv } = resolveWorkerEntrypoint();
  console.log("[main] launching worker:", entry);
  worker = new import_node_worker_threads.Worker(entry, execArgv?.length ? { execArgv } : void 0);
  worker.on("message", (msg) => {
    if (typeof msg === "string") return sendLog({ msg });
    if (msg?.channel === "log") {
      const text = typeof msg.payload === "string" ? msg.payload : JSON.stringify(msg.payload);
      return sendLog({ runId: msg.runId, level: msg.level ?? "info", msg: text });
    }
    if (msg?.channel === "humanPause") {
      return sendLog({ runId: msg.runId, msg: `[human pause] ${msg.reason}` });
    }
    sendLog({ msg: JSON.stringify(msg) });
  });
  worker.on("error", (err) => sendLog({ level: "error", msg: `[worker error] ${err.message}` }));
  worker.on("exit", (code) => {
    sendLog({ msg: `[worker exit] code=${code}` });
    worker = null;
  });
  return worker;
}
function createWindow() {
  const preloadPath = import_node_path.default.join(__dirname, "preload.js");
  console.log("[main] preload at:", preloadPath, exists(preloadPath) ? "(exists)" : "(MISSING)");
  win = new import_electron.BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    console.log("[main] renderer loaded:", win?.webContents.getURL());
  });
  const devUrl = process.env.ELECTRON_START_URL || process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
  if (devUrl && !import_electron.app.isPackaged) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(import_node_path.default.join(__dirname, "../index.html"));
  }
}
import_electron.app.whenReady().then(createWindow);
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
import_electron.app.on("activate", () => {
  if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
});
import_electron.ipcMain.handle("agent:run", async (_e, { task, selectorBundle }) => {
  const runId = import_node_crypto.default.randomUUID();
  activeRunId = runId;
  ensureWorker().postMessage({ type: "run", runId, task, selectorBundle });
  return { ok: true, runId };
});
import_electron.ipcMain.handle("agent:stop", async () => {
  worker?.postMessage({ type: "stop" });
  return { ok: true };
});
import_electron.ipcMain.handle("agent:takeOver", async () => {
  worker?.postMessage({ type: "takeOver" });
  return { ok: true };
});
import_electron.ipcMain.handle("agent:resume", async () => {
  worker?.postMessage({ type: "resume" });
  return { ok: true };
});
import_electron.ipcMain.handle(
  "shell:showInFolder",
  (_e, filePath) => import_electron.shell.showItemInFolder(filePath)
);
import_electron.ipcMain.handle("alpha:hello", () => "ok");
//# sourceMappingURL=main.js.map
