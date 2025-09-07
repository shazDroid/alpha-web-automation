import type { Page } from "playwright";
import { chromium } from "playwright";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { getAttachedPage } from "./browser.js";


type PWLoadState = "load" | "domcontentloaded" | "networkidle";

export type Step =
    | { op: "goto"; url: string }
    | { op: "type"; hint: string; text: string; secure?: boolean }
    | { op: "click"; hint?: string; text?: string }
    | { op: "waitFor"; state: "selector"; selector: string }
    | { op: "waitFor"; state: PWLoadState }
    | { op: "withinFrame"; selector: string }
    | { op: "expectText"; text: string }
    | { op: "requireHuman"; reason: string };

export type RunState = {
    goal: string;
    steps: Step[];
    i: number;
    page: Page;
    timeline: any[];
    selectorBundle: Record<string, any[]>;
    lastOk?: boolean;
    humanPause?: (reason: string)=>Promise<void>;
    onLog?: (m:any)=>void;
};

export async function resolveSelector(hint: string, page: Page, bundle: Record<string, any[]>) {
    const prefs = bundle?.[hint] ?? [];
    const trySeq = [
        (s:any)=> s.css && page.locator(s.css),
        (s:any)=> s.role && page.getByRole(s.role.role, { name: s.role.name }),
        (s:any)=> s.text && page.getByText(s.text, { exact: !!s.exact }),
        (s:any)=> s.testId && page.getByTestId(s.testId),
        (s:any)=> s.xpath && page.locator(`xpath=${s.xpath}`)
    ];
    for (const pref of prefs) {
        for (const make of trySeq) {
            const loc = make(pref);
            if (!loc) continue;
            try { await loc.first().waitFor({ state: "visible", timeout: 600 }); return loc.first(); } catch {}
        }
    }
    throw new Error(`No selector resolved for '${hint}'`);
}

async function executor(state: RunState) {
    const step = state.steps[state.i];
    const log = (m:any)=> state.onLog?.(m);
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
                if (step.text) await state.page.getByText(step.text, { exact: true }).click();
                else {
                    const loc = await resolveSelector(step.hint!, state.page, state.selectorBundle);
                    await loc.click();
                }
                break;
            }
            case "waitFor":
                if (step.state === "selector") {
                    await state.page.waitForSelector(step.selector, { state: "visible" });
                } else {
                    await state.page.waitForLoadState(step.state);
                }
                break;
            case "withinFrame": {
                const frame = await (await state.page.waitForSelector(step.selector)).contentFrame();
                (global as any).__frame = frame;
                break;
            }
            case "expectText": {
                const ctx: any = (global as any).__frame || state.page;
                await ctx.getByText(step.text).waitFor({ state: "visible" });
                break;
            }
            case "requireHuman":
                if (!state.humanPause) throw new Error("Human pause bridge missing");
                await state.humanPause(step.reason);
                break;
        }
        const snap = await state.page.screenshot({ fullPage: false }).catch(() => undefined);
        state.timeline.push({ ok:true, step, t: Date.now(), snap });
        log({ ok:true, step });
        state.lastOk = true;
        state.i++;
    } catch (e:any) {
        state.timeline.push({ ok:false, step, error:e.message, t: Date.now() });
        log({ ok:false, step, error: e.message });
        state.lastOk = false;
    }
    return state;
}

async function critic(state: RunState) {
    if (!state.lastOk) {
        // simple escalation; you can expand with retries/alt selectors
        state.steps.splice(state.i, 0, { op:"requireHuman", reason:`Failed: ${state.steps[state.i].op}` });
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

type Route = "exec" | "crit" | "end";
const router: ((s: any) => Route) = (state: any) => {
    if (state.i >= state.steps.length) return "end";
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
    const { browser, context, page } = await getAttachedPage();
    return { browser, page };
}
