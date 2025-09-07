import { chromium, Browser, BrowserContext, Page } from "playwright";

// --- URLs to ignore so we attach to the <webview> instead of the shell
const UI_ORIGINS = [
    /^http:\/\/localhost:5173/i,     // dev UI
    /^file:.*\/index\.html$/i        // packaged UI
];

const isSystemUrl = (u: string) => /^chrome:|^devtools:|^edge:/.test(u);
const isUiUrl     = (u: string) => UI_ORIGINS.some(r => r.test(u));

let cached: { browser: Browser; context: BrowserContext; page: Page } | null = null;

/**
 * Scan existing contexts for a guest page (the <webview>) that is neither
 * a system URL nor the app shell (localhost:5173/file://…/index.html).
 */
async function pickGuestPage(browser: Browser): Promise<{ context: BrowserContext; page: Page } | null> {
    for (const ctx of browser.contexts()) {
        const page = ctx.pages().find(p => {
            const u = p.url();
            return u && !isSystemUrl(u) && !isUiUrl(u);
        });
        if (page) return { context: ctx, page };
    }
    return null;
}

/**
 * Like before, but without any invalid Browser events.
 * We connect to the Electron CDP, try to find an existing guest page, and
 * if not present, we poll briefly until it appears.
 */
export async function getAttachedPage(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    if (cached) return cached;

    // Electron main must be started with --remote-debugging-port=9222
    const browser = await chromium.connectOverCDP("http://localhost:9222");

    // 1) Try current contexts first
    const foundNow = await pickGuestPage(browser);
    if (foundNow) {
        cached = { browser, ...foundNow };
        console.log("[agent] attached to webview:", foundNow.page.url());
        return cached;
    }

    // 2) Poll briefly for the webview to appear
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const foundLater = await pickGuestPage(browser);
        if (foundLater) {
            cached = { browser, ...foundLater };
            console.log("[agent] attached to webview (late):", foundLater.page.url());
            return cached;
        }
        await new Promise(r => setTimeout(r, 150));
    }

    throw new Error("Timed out waiting for webview page (guest) to appear");
}

// Optional: a strict guard to guarantee nobody launches a new browser
export function assertNoLaunch(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyChromium = chromium as any;
    const orig = anyChromium.launch;
    anyChromium.launch = async () => {
        throw new Error(
            "[guard] chromium.launch() was called. Use getAttachedPage() from packages/agent/src/browser.ts instead."
        );
    };
    // You can restore with: anyChromium.launch = orig;
}
