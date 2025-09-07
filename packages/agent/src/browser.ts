import { chromium, Browser, BrowserContext, Page } from "playwright";
import { parentPort } from "worker_threads";

// --- 1) Wait until main notifies that the <webview> is alive -----------------
let resolveWebview!: (id: number) => void;
const webviewReady = new Promise<number>((r) => (resolveWebview = r));

// Add near the top of the file
function isAppUrl(u: string): boolean {
    if (!u) return false;
    // exclude your renderer (dev server or packaged index)
    return u.startsWith("http://localhost:5173")
        || u.startsWith("http://127.0.0.1:5173")
        || u.startsWith("file://");
}

function pickGuestPage(pages: import("playwright").Page[]) {
    // Prefer non-app pages; the webview guest will usually show as about:blank first,
    // then your real target URL.
    const nonApp = pages.filter(p => !isAppUrl(p.url()));
    if (nonApp.length) return nonApp[nonApp.length - 1];
    // Fallback to last page if we couldn't filter (keeps previous behaviour)
    return pages[pages.length - 1];
}


parentPort?.on("message", (msg: any) => {
    if (msg?.type === "webview-ready" && typeof msg.webContentsId === "number") {
        resolveWebview(msg.webContentsId);
    }
});

// --- 2) Small helpers ---------------------------------------------------------
function isRealHttpUrl(u: string) {
    return /^https?:\/\//i.test(u);
}

function isNoiseUrl(u: string) {
    return (
        !u ||
        u === "about:blank" ||
        u.startsWith("devtools://") ||
        u.startsWith("chrome://")
    );
}

// --- 3) The only thing agents should call ------------------------------------
export async function getAttachedPage(): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
}> {
    // (a) wait for the renderer's <webview> to be attached
    await webviewReady;

    // (b) connect to Electron's CDP (enabled by main.ts via remote-debugging-port=9222)
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

    // (c) Electron's default context holds our guest page(s)
    let context = browser.contexts()[0];
    let pages = context.pages();

// Wait a moment for the guest to appear if needed
    const giveUpAt = Date.now() + 5000;
    while (pages.filter(p => !isAppUrl(p.url())).length === 0 && Date.now() < giveUpAt) {
        await new Promise(r => setTimeout(r, 100));
        pages = context.pages();
    }

    const page = pickGuestPage(pages);
// optional: double check we didn’t pick your app page
    if (isAppUrl(page.url())) {
        // as a last resort, wait a little and try again once
        await new Promise(r => setTimeout(r, 300));
        pages = context.pages();
        const retry = pickGuestPage(pages);
        if (!isAppUrl(retry.url())) {
            return { browser, context, page: retry };
        }
    }

    return { browser, context, page };
}
