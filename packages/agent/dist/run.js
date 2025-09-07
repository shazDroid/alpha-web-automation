import { buildGraph, launchBrowser } from "./graph";
export async function runGoal(goal, steps, selectorBundle, onLog, onHumanPause) {
    const { browser, page } = await launchBrowser();
    const app = buildGraph();
    const state = {
        goal, steps, i: 0, page,
        selectorBundle, timeline: [],
        humanPause: onHumanPause,
        onLog
    };
    const res = await app.invoke(state);
    await browser.close();
    return res;
}
