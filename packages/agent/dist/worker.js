import { parentPort } from "node:worker_threads";
import { runGoal } from "./run";
if (!parentPort)
    process.exit(1);
let pausedResolve = null;
parentPort.on("message", async (msg) => {
    switch (msg.type) {
        case "run": {
            const runId = msg.runId || `${Date.now()}`;
            const goal = msg.task;
            const bundle = (msg.selectorBundle || {});
            const steps = [
                { op: "goto", url: "https://example.com" },
                { op: "expectText", text: "Example Domain" },
            ];
            const onLog = (payload) => parentPort.postMessage({ channel: "log", runId, payload, level: "info" });
            const onHumanPause = (reason) => new Promise((resolve) => {
                parentPort.postMessage({ channel: "humanPause", runId, reason });
                pausedResolve = resolve;
            });
            try {
                parentPort.postMessage({ channel: "log", runId, payload: `[agent] starting: ${goal}`, level: "info" });
                await runGoal(goal, steps, bundle, onLog, onHumanPause);
                parentPort.postMessage({ channel: "log", runId, payload: `[agent] finished`, level: "info" });
            }
            catch (e) {
                parentPort.postMessage({ channel: "log", runId, payload: `[agent] error: ${e.message}`, level: "error" });
            }
            break;
        }
        case "takeOver":
            parentPort.postMessage({ channel: "log", runId: "manual", payload: "[agent] TakeOver acknowledged" });
            break;
        case "resume":
            if (pausedResolve) {
                pausedResolve();
                pausedResolve = null;
            }
            parentPort.postMessage({ channel: "log", runId: "manual", payload: "[agent] resumed" });
            break;
        case "stop":
            parentPort.postMessage({ channel: "log", runId: "manual", payload: "[agent] stop requested" });
            process.exit(0);
    }
});
