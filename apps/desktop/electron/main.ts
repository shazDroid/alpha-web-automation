import fs from "node:fs";
import path from "node:path";
import {app, BrowserWindow, ipcMain, shell} from "electron";
import {Worker} from "node:worker_threads";
import crypto from "node:crypto";

let win: BrowserWindow | null = null;
let worker: Worker | null = null;
let activeRunId: string | null = null;

function sendLog(obj: { msg: string; level?: "info" | "error"; runId?: string }) {
  win?.webContents.send("agent:log", {
    runId: obj.runId ?? activeRunId ?? "default",
    level: obj.level ?? "info",
    msg: obj.msg,
    at: Date.now(),
  });
}

const exists = (p: string) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

/** Find the monorepo's packages/agent directory in dev & prod */
function agentBaseDir(): string {
  const candidates = [
    path.resolve(app.getAppPath(), "..", "packages", "agent"),
    path.resolve(__dirname, "..", "..", "..", "packages", "agent"),
    path.resolve(process.cwd(), "..", "packages", "agent"),
  ];
  for (const p of candidates) if (exists(p)) return p;
  throw new Error(
      `Could not locate packages/agent. Tried:\n${candidates.map((p) => " - " + p).join("\n")}`
  );
}

function resolveWorkerEntrypoint(): { entry: string; execArgv?: string[] } {
  const base = agentBaseDir(); // .../packages/agent

  const distWorker = path.join(base, "dist", "worker.js");
  const distRun    = path.join(base, "dist", "run.js");
  const srcWorker  = path.join(base, "src", "worker.ts");

  // Use dist only if ALL required outputs exist (packaged or dev)
  if (fs.existsSync(distWorker) && fs.existsSync(distRun)) {
    return { entry: distWorker };
  }

  // Fallback to TS in dev via ts-node loader
  if (fs.existsSync(srcWorker)) {
    return { entry: srcWorker, execArgv: ["--loader", "ts-node/esm"] };
    // If you prefer CJS register instead:
    // return { entry: srcWorker, execArgv: ["-r", "ts-node/register/transpile-only"] };
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

  worker = new Worker(entry, execArgv?.length ? { execArgv } : undefined);

  worker.on("message", (msg: any) => {
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
  worker.on("exit", (code) => { sendLog({ msg: `[worker exit] code=${code}` }); worker = null; });

  return worker;
}


function createWindow() {
  const preloadPath = path.join(__dirname, "preload.js");
  console.log("[main] preload at:", preloadPath, exists(preloadPath) ? "(exists)" : "(MISSING)");

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  win.webContents.on("did-finish-load", () => {
    console.log("[main] renderer loaded:", win?.webContents.getURL());
  });

  const devUrl =
      process.env.ELECTRON_START_URL ||
      process.env.VITE_DEV_SERVER_URL ||
      "http://localhost:5173";

  if (devUrl && !app.isPackaged) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "../index.html"));
  }
}

// ---- App lifecycle
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC
ipcMain.handle("agent:run", async (_e, { task, selectorBundle }) => {
  const runId = crypto.randomUUID();
  activeRunId = runId;
  ensureWorker().postMessage({ type: "run", runId, task, selectorBundle });
  return {ok: true, runId};
});

ipcMain.handle("agent:stop", async () => {
  worker?.postMessage({ type: "stop" });
  return { ok: true };
});
ipcMain.handle("agent:takeOver", async () => {
  worker?.postMessage({ type: "takeOver" });
  return { ok: true };
});
ipcMain.handle("agent:resume", async () => {
  worker?.postMessage({ type: "resume" });
  return { ok: true };
});

ipcMain.handle("shell:showInFolder", (_e, filePath: string) =>
    shell.showItemInFolder(filePath)
);

// tiny debug helper so you can test the bridge from console: await window.alpha?.hello?.()
ipcMain.handle("alpha:hello", () => "ok");
