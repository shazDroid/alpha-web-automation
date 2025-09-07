// apps/desktop/electron/main.ts
import fs from "node:fs";
import path from "node:path";
import {app, BrowserWindow, ipcMain, shell} from "electron";
import {Worker} from "node:worker_threads";
import crypto from "node:crypto";
import WebContents = Electron.WebContents;

let win: BrowserWindow | null = null;
let worker: Worker | null = null;          // <— declare BEFORE ensureWorker
let activeRunId: string | null = null;
let lastWebviewGuestId: number | null = null;

app.commandLine.appendSwitch("remote-debugging-port", "9222");
app.commandLine.appendSwitch("remote-allow-origins", "*");

let latestWebviewId: number | null = null;

/** Send a line to the renderer timeline */
function sendLog(obj: { msg: string; level?: "info" | "error"; runId?: string }) {
  win?.webContents.send("agent:log", {
    runId: obj.runId ?? activeRunId ?? "default",
    level: obj.level ?? "info",
    msg: obj.msg,
    at: Date.now(),
  });
}


/** Create / (re)use worker */
function agentPackageJson(): any {
  const base = agentBaseDir();
  const pkg = path.join(base, "package.json");
  try { return JSON.parse(fs.readFileSync(pkg, "utf8")); } catch { return null; }
}


function agentBaseDir(): string {
  const candidates = [
    path.resolve(app.getAppPath(), "..", "packages", "agent"),
    path.resolve(__dirname, "..", "..", "..", "packages", "agent"),
    path.resolve(process.cwd(), "..", "packages", "agent"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error(
      `Could not locate packages/agent. Tried:\n${candidates.map((p) => " - " + p).join("\n")}`
  );
}

function resolveWorkerPaths() {
  const base = agentBaseDir();
  return {
    js: path.join(base, "dist", "worker.js"), // built output
    ts: path.join(base, "src", "worker.ts"),  // dev source
  };
}

function ensureWorker(): Worker {
  if (worker && worker.threadId) return worker;

  const { js, ts } = resolveWorkerPaths();

  if (fs.existsSync(js)) {
    // Prefer built JS when available (stable)
    console.log("[main] launching worker (built JS):", js);
    worker = new Worker(js); // <-- no `type` option
  } else if (fs.existsSync(ts)) {
    console.log("[main] launching worker (ts-node/esm):", ts);
    worker = new Worker(ts, {
      execArgv: ["--loader", "ts-node/esm"],
    });
  } else {
    throw new Error(
        `Worker entry not found:\n - ${js}\n - ${ts}\n` +
        `If you want to run the built worker, run: npm run build -w packages/agent`
    );
  }

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
  worker.on("exit",  (code) => { sendLog({ msg: `[worker exit] code=${code}` }); worker = null; });

  if (lastWebviewGuestId != null) {
    worker.postMessage({ type: "webview-ready", webContentsId: lastWebviewGuestId });
  }

  return worker;
}


/** BrowserWindow */
function createWindow() {
  const preloadPath = path.join(__dirname, "preload.js");
  sendLog({ msg: `[main] preload at: ${preloadPath} ${fs.existsSync(preloadPath) ? "(exists)" : "(MISSING)"}` });

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

  win.webContents.on("did-attach-webview", (_e, guest: WebContents) => {
    latestWebviewId = guest.id;
    sendLog({msg: `[main] webview attached (guest id=${guest.id})`});
    worker?.postMessage({type: "webview-ready", webContentsId: guest.id});
  });

  win.webContents.on("did-finish-load", () => {
    sendLog({ msg: `[main] renderer loaded: ${win?.webContents.getURL()}` });
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

  // Prevent the app shell (main renderer) from navigating away
  win.webContents.on("will-navigate", (e, url) => {
    const isAppUrl =
        (devUrl && url.startsWith(devUrl)) ||
        url.startsWith("file://");
    if (!isAppUrl) e.preventDefault();
  });

// Also deny window.open() from replacing our shell
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function notifyWorkerWebviewReady(id: number) {
  lastWebviewGuestId = id;
  if (worker) {
    worker.postMessage({ type: "webview-ready", webContentsId: id });
  }
}

/* ---------- app lifecycle ---------- */
app.whenReady().then(createWindow);
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() === "webview") {
    notifyWorkerWebviewReady(contents.id);
    contents.once("dom-ready", () => notifyWorkerWebviewReady(contents.id));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ---------- IPC ---------- */
ipcMain.handle("agent:run", async (_e, { task, selectorBundle }) => {
  const runId = crypto.randomUUID();
  activeRunId = runId;
  ensureWorker().postMessage({ type: "run", runId, task, selectorBundle });
  return { ok: true, runId };
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

ipcMain.handle("webview:ready", (_e, id: number) => {
  latestWebviewId = id;
  sendLog({msg: `[main] webview:ready (guest id=${id})`});
  worker?.postMessage({type: "webview-ready", webContentsId: id});
  return {ok: true};
});

ipcMain.handle("webview:get-latest", () => latestWebviewId);

ipcMain.handle("shell:showInFolder", (_e, filePath: string) => shell.showItemInFolder(filePath));
ipcMain.handle("alpha:hello", () => "ok");
