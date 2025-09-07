import { chromium } from 'playwright';
import { waitNetworkIdle, download } from './action';
let browser = null;
let page = null;
async function ensurePage() {
    if (!browser) {
        browser = await chromium.launch({ headless: true });
    }
    if (!page) {
        const ctx = await browser.newContext();
        page = await ctx.newPage();
    }
    return page;
}
function log(emit, msg, level = 'info') {
    emit(msg, level);
}
function resolveSelector(sel) {
    if (sel.startsWith('role=') || sel.startsWith('text='))
        return sel;
    if (sel.startsWith('css='))
        return sel.slice(4);
    return sel;
}
async function stepOpen(p, url, emit) {
    log(emit, `open ${url}`);
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { url: p.url(), title: (await p.title()).trim() };
}
async function stepClick(p, selector, emit) {
    const sel = resolveSelector(selector);
    log(emit, `click ${selector}`);
    await p.click(sel, { timeout: 15000 });
}
async function stepType(p, selector, text, emit) {
    const sel = resolveSelector(selector);
    log(emit, `type ${JSON.stringify(text)} into ${selector}`);
    await p.fill(sel, text, { timeout: 15000 });
}
async function stepWaitFor(p, selectorOrText, emit) {
    // supports text="..." or a selector
    if (selectorOrText.startsWith('text=')) {
        const text = selectorOrText.slice(5);
        log(emit, `waitFor text ${JSON.stringify(text)}`);
        await p.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 });
    }
    else {
        const sel = resolveSelector(selectorOrText);
        log(emit, `waitFor ${selectorOrText}`);
        await p.waitForSelector(sel, { timeout: 15000 });
    }
}
async function stepGetText(p, selector, emit) {
    const sel = resolveSelector(selector);
    log(emit, `getText ${selector}`);
    const el = await p.waitForSelector(sel, { timeout: 15000 });
    const text = (await el.textContent())?.trim() ?? '';
    return [{ selector, text }];
}
async function stepScreenshot(p, name, emit) {
    const dir = '.screenshots';
    const fs = await import('fs');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const path = `${dir}/${name.replace(/[^a-z0-9._-]+/gi, '_')}`;
    await p.screenshot({ path, fullPage: true });
    log(emit, `🖼 screenshot: ${path}`);
    return { path };
}
export async function runTask(task, emit) {
    const p = await ensurePage();
    const logs = [];
    const _emit = (m, lvl = 'info') => {
        logs.push(m);
        emit(m, lvl);
    };
    // Split DSL by "->" steps (and newlines), trim empties
    const steps = task
        .split(/\n|->/g)
        .map(s => s.trim())
        .filter(Boolean);
    let lastResult = null;
    try {
        for (const raw of steps) {
            // open <url>
            let m = raw.match(/^open\s+(.+)$/i);
            if (m) {
                lastResult = await stepOpen(p, m[1], _emit);
                continue;
            }
            // click <selector>
            m = raw.match(/^click\s+(.+)$/i);
            if (m) {
                await stepClick(p, m[1], _emit);
                continue;
            }
            // type <selector> "<text>"
            m = raw.match(/^type\s+(\S+)\s+"([\s\S]*)"$/i);
            if (m) {
                await stepType(p, m[1], m[2], _emit);
                continue;
            }
            // waitFor <selector|text="...">
            m = raw.match(/^waitFor\s+(.+)$/i);
            if (m) {
                await stepWaitFor(p, m[1], _emit);
                continue;
            }
            // getText <selector>
            m = raw.match(/^getText\s+(.+)$/i);
            if (m) {
                lastResult = await stepGetText(p, m[1], _emit);
                continue;
            }
            // waitNetworkIdle [idleMs] [timeoutMs]
            m = raw.match(/^waitNetworkIdle(?:\s+(\d+))?(?:\s+(\d+))?$/i);
            if (m) {
                lastResult = await waitNetworkIdle(p, m[1] ? +m[1] : 800, m[2] ? +m[2] : 15000);
                _emit(String(lastResult));
                continue;
            }
            // download [selector]
            m = raw.match(/^download(?:\s+(.+))?$/i);
            if (m) {
                lastResult = await download(p, m[1]);
                _emit(String(lastResult));
                continue;
            }
            // screenshot <name>
            m = raw.match(/^screenshot\s+(.+)$/i);
            if (m) {
                lastResult = await stepScreenshot(p, m[1], _emit);
                continue;
            }
            // navigate webview URL from UI
            m = raw.match(/^goto\s+(.+)$/i);
            if (m) {
                lastResult = await stepOpen(p, m[1], _emit);
                continue;
            }
            // unknown step
            throw new Error(`Unknown step: ${raw}`);
        }
        return { ok: true, result: lastResult, logs };
    }
    catch (e) {
        _emit(`failed: ${e?.message ?? e}`, 'error');
        return { ok: false, error: String(e?.message ?? e), logs };
    }
}
export async function stop() {
    // If you want to cancel mid-run, you could track a flag and check it inside steps
    return { ok: true };
}
