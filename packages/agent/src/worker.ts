import { parentPort } from "node:worker_threads";
import { runGoal } from "./run.js";
import type { Step } from "./graph.js";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import {assertNoLaunch} from "./browser.js";


if (!parentPort) process.exit(1);
let pausedResolve: null | (() => void) = null;

assertNoLaunch();

const UI_ORIGINS = [
    /^http:\/\/localhost:5173/i,      // dev
    /^file:.*\/index\.html$/i         // packaged
];

const isSystemUrl = (u: string) => /^chrome:|^devtools:|^edge:/.test(u);
const isUiUrl     = (u: string) => UI_ORIGINS.some(r => r.test(u));

async function attachToEmbeddedWebview(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    // Connect to the Electron instance (main added remote-debugging-port 9222)
    const browser = await chromium.connectOverCDP("http://localhost:9222");

    // Try to find an existing webview page (non-system and not our UI)
    const pickExisting = () => {
        for (const ctx of browser.contexts()) {
            const page = ctx.pages().find(p => {
                const u = p.url();
                return u && !isSystemUrl(u) && !isUiUrl(u);
            });
            if (page) return { context: ctx, page };
        }
        return null;
    };

    const found = pickExisting();
    if (found) return { browser, context: found.context, page: found.page };

    // If not found yet, wait for the next guest page to appear
    const waiter = new Promise<{ context: BrowserContext; page: Page }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for webview target")), 10000);

        for (const ctx of browser.contexts()) {
            ctx.on("page", (p) => {
                const u = p.url();
                if (!isSystemUrl(u) && !isUiUrl(u)) {
                    clearTimeout(timer);
                    resolve({ context: ctx, page: p });
                }
            });
        }
    });

    const { context, page } = await waiter;
    return { browser, context, page };
}

let attachedOnce: { browser: Browser; context: BrowserContext; page: Page } | null = null;

export async function getAttachedPage(): Promise<Page> {
    if (!attachedOnce) attachedOnce = await attachToEmbeddedWebview();
    return attachedOnce.page;
}



parentPort.on("message", async (msg: any) => {
    switch (msg.type) {
        case "run": {
            const runId: string = msg.runId || `${Date.now()}`;
            const goal: string = msg.task;
            const bundle = (msg.selectorBundle || {}) as Record<string, any[]>;

            const steps: Step[] = [
                { op: "goto", url: "https://example.com" },
                { op: "expectText", text: "Example Domain" },
            ];

            const onLog = (payload: any) =>
                parentPort!.postMessage({ channel: "log", runId, payload, level: "info" });

            const onHumanPause = (reason: string) =>
                new Promise<void>((resolve) => {
                    parentPort!.postMessage({ channel: "humanPause", runId, reason });
                    pausedResolve = resolve;
                });

            try {
                parentPort!.postMessage({ channel: "log", runId, payload: `[agent] starting: ${goal}`, level: "info" });
                await runGoal(goal, steps, bundle, onLog, onHumanPause);
                parentPort!.postMessage({ channel: "log", runId, payload: `[agent] finished`, level: "info" });
            } catch (e: any) {
                parentPort!.postMessage({ channel: "log", runId, payload: `[agent] error: ${e.message}`, level: "error" });
            }
            break;
        }
        case "takeOver":
            parentPort!.postMessage({ channel: "log", runId: "manual", payload: "[agent] TakeOver acknowledged" });
            break;
        case "resume":
            if (pausedResolve) { pausedResolve(); pausedResolve = null; }
            parentPort!.postMessage({ channel: "log", runId: "manual", payload: "[agent] resumed" });
            break;
        case "stop":
            parentPort!.postMessage({ channel: "log", runId: "manual", payload: "[agent] stop requested" });
            process.exit(0);
    }
});
