// /api/translator/console-logs (GET, DELETE) and its SSE stream, using the
// { type: "init" | "line" | "lines" | "clear" } messages transport.js expects.
import { sse } from "../../http.js";
import { LANES } from "../../fixtures/usageLanes.js";
import { laneWeightNow, makeRequestEvent, pickWeighted, usageHistory } from "../../fixtures/usageHistory.js";
import { housekeepingLine, linesForEvent, seedConsoleLines } from "../../fixtures/consoleLogLines.js";

const MAX_LINES = 500;
let buffer = null;
let counter = 0;

function lines() {
  if (!buffer) buffer = seedConsoleLines(usageHistory().recent.slice(0, 60), Date.now()).slice(-MAX_LINES);
  return buffer;
}

function append(next) {
  buffer = [...lines(), ...next].slice(-MAX_LINES);
  return next;
}

function nextMessage() {
  counter += 1;
  const now = Date.now();
  if (counter % 6 === 0) return { type: "line", line: append([housekeepingLine(counter, now)])[0] };
  const lane = pickWeighted(Math.random, LANES, laneWeightNow);
  const event = makeRequestEvent(lane, Math.random, now, usageHistory().scales);
  return { type: "lines", lines: append(linesForEvent(event)) };
}

export default function registerConsoleLog(router) {
  router.get("/api/translator/console-logs", () => ({ success: true, logs: lines() }));

  router.delete("/api/translator/console-logs", () => {
    buffer = [];
    return { success: true };
  });

  router.get("/api/translator/console-logs/stream", () =>
    sse({ events: [{ type: "init", logs: lines() }], next: nextMessage, intervalMs: 1500 }),
  );
}
