import { parentPort } from "node:worker_threads";
import { runGoal } from "./run.js";
import type { Step } from "./graph.js";

if (!parentPort) process.exit(1);
let pausedResolve: null | (() => void) = null;

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
