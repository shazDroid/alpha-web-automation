import { buildGraph, launchBrowser, RunState, Step } from "./graph";

export async function runGoal(
    goal: string,
    steps: Step[],
    selectorBundle: Record<string, any[]>,
    onLog: (m:any)=>void,
    onHumanPause: (reason: string)=>Promise<void>
) {
    const { browser, page } = await launchBrowser();
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
