import { buildGraph, launchBrowser, RunState, Step } from "./graph.js";
import { getAttachedPage } from "./browser.js";


export async function runGoal(
    goal: string,
    steps: Step[],
    selectorBundle: Record<string, any[]>,
    onLog: (m:any)=>void,
    onHumanPause: (reason: string)=>Promise<void>
) {
    const { browser, context, page } = await getAttachedPage();
    const app = buildGraph();
    const state: RunState = {
        goal, steps, i: 0, page,
        selectorBundle, timeline: [],
        humanPause: onHumanPause,
        onLog
    };
    const res = await app.invoke(state);
    await browser.close();
    return res;
}
