import { chromium } from "playwright";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
export async function resolveSelector(hint, page, bundle) {
    const prefs = bundle?.[hint] ?? [];
    const trySeq = [
        (s) => s.css && page.locator(s.css),
        (s) => s.role && page.getByRole(s.role.role, { name: s.role.name }),
        (s) => s.text && page.getByText(s.text, { exact: !!s.exact }),
        (s) => s.testId && page.getByTestId(s.testId),
        (s) => s.xpath && page.locator(`xpath=${s.xpath}`)
    ];
    for (const pref of prefs) {
        for (const make of trySeq) {
            const loc = make(pref);
            if (!loc)
                continue;
            try {
                await loc.first().waitFor({ state: "visible", timeout: 600 });
                return loc.first();
            }
            catch { }
        }
    }
    throw new Error(`No selector resolved for '${hint}'`);
}
async function executor(state) {
    const step = state.steps[state.i];
    const log = (m) => state.onLog?.(m);
    try {
        switch (step.op) {
            case "goto":
                await state.page.goto(step.url, { waitUntil: "domcontentloaded" });
                break;
            case "type": {
                const loc = await resolveSelector(step.hint, state.page, state.selectorBundle);
                await loc.fill(step.text);
                break;
            }
            case "click": {
                if (step.text)
                    await state.page.getByText(step.text, { exact: true }).click();
                else {
                    const loc = await resolveSelector(step.hint, state.page, state.selectorBundle);
                    await loc.click();
                }
                break;
            }
            case "waitFor":
                if (step.state === "selector") {
                    await state.page.waitForSelector(step.selector, { state: "visible" });
                }
                else {
                    await state.page.waitForLoadState(step.state);
                }
                break;
            case "withinFrame": {
                const frame = await (await state.page.waitForSelector(step.selector)).contentFrame();
                global.__frame = frame;
                break;
            }
            case "expectText": {
                const ctx = global.__frame || state.page;
                await ctx.getByText(step.text).waitFor({ state: "visible" });
                break;
            }
            case "requireHuman":
                if (!state.humanPause)
                    throw new Error("Human pause bridge missing");
                await state.humanPause(step.reason);
                break;
        }
        const snap = await state.page.screenshot({ fullPage: false }).catch(() => undefined);
        state.timeline.push({ ok: true, step, t: Date.now(), snap });
        log({ ok: true, step });
        state.lastOk = true;
        state.i++;
    }
    catch (e) {
        state.timeline.push({ ok: false, step, error: e.message, t: Date.now() });
        log({ ok: false, step, error: e.message });
        state.lastOk = false;
    }
    return state;
}
async function critic(state) {
    if (!state.lastOk) {
        // simple escalation; you can expand with retries/alt selectors
        state.steps.splice(state.i, 0, { op: "requireHuman", reason: `Failed: ${state.steps[state.i].op}` });
    }
    return state;
}
const RunStateSchema = Annotation.Root({
    goal: Annotation(),
    steps: Annotation(),
    i: Annotation(),
    page: Annotation(),
    timeline: Annotation(),
    selectorBundle: Annotation(),
    lastOk: Annotation(),
    humanPause: Annotation(),
    onLog: Annotation(),
});
const router = (state) => {
    if (state.i >= state.steps.length)
        return "end";
    return state.lastOk === false ? "crit" : "exec";
};
export function buildGraph() {
    return new StateGraph(RunStateSchema)
        .addNode("executor", executor)
        .addNode("critic", critic)
        .addEdge(START, "executor")
        .addConditionalEdges("executor", router, {
        exec: "executor",
        crit: "critic",
        end: END,
    })
        .addConditionalEdges("critic", router, {
        exec: "executor",
        crit: "critic",
        end: END,
    })
        .compile();
}
export async function launchBrowser() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    return { browser, page };
}
