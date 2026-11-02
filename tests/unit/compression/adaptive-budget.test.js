// #1100: adaptive context budgets and explicit plan precedence.
import { describe, expect, it } from "vitest";
import { normalizeContextBudgetConfig, DEFAULT_CONTEXT_BUDGET } from "../../../open-sse/services/compression/adaptiveCompression/types.js";
import { computeTarget } from "../../../open-sse/services/compression/adaptiveCompression/computeTarget.js";
import { runCompressionSeam } from "../../../open-sse/handlers/chatCore/compressionHook.js";

const REPEATED = Array.from({ length: 12 }, (_, i) => `worker ${i % 3} reported queue depth zero and heartbeat ok`).join("\n");
const body = () => ({
  messages: [
    { role: "user", content: `I would really like you to please basically look at these logs:\n${REPEATED}` },
    { role: "assistant", content: "They look healthy." },
    { role: "user", content: `I would really like you to please basically compare again:\n${REPEATED}` },
  ],
});

const seam = (engines, adaptive, log) => runCompressionSeam(body(), undefined, {
  enabled: true,
  engines,
  applyOpts: {},
  adaptive: { estimatedTokens: 10_000, requestMaxTokens: null, ...adaptive },
  log,
});
const engineList = (out) => (out.headerValue ?? "|").split("|")[0];

describe("normalizeContextBudgetConfig", () => {
  it("falls back to safe defaults for missing or invalid fields", () => {
    expect(normalizeContextBudgetConfig(undefined)).toEqual(DEFAULT_CONTEXT_BUDGET);
    expect(normalizeContextBudgetConfig({ mode: "yolo", policy: "x", outputReserve: -1, pct: 2, safetyMargin: "a" })).toEqual(DEFAULT_CONTEXT_BUDGET);
  });

  it("keeps valid fields and filters the ladder override", () => {
    expect(normalizeContextBudgetConfig({
      mode: "floor", policy: "percentage", pct: 0.5, outputReserve: 100.7,
      ladderOverride: [{ engine: "lite" }, { engine: 3 }, null, { engine: "caveman", intensity: "full" }],
    })).toEqual({
      ...DEFAULT_CONTEXT_BUDGET, mode: "floor", policy: "percentage", pct: 0.5, outputReserve: 100,
      ladderOverride: [{ engine: "lite" }, { engine: "caveman", intensity: "full" }],
    });
  });
});

describe("output reservation", () => {
  it("reserves the resolved model output, else the configured reserve", () => {
    const cfg = { ...DEFAULT_CONTEXT_BUDGET };
    expect(computeTarget("reserve-output", 32_000, 8192, cfg)).toBe(32_000 - 8192 - 1024);
    expect(computeTarget("reserve-output", 32_000, null, cfg)).toBe(32_000 - 4096 - 1024);
    expect(computeTarget("reserve-output", 1000, 8192, cfg)).toBe(0);
  });
});

describe("plan precedence in the seam", () => {
  const overflow = { mode: "replace-autotrigger", policy: "reserve-output", modelContextLimit: 8000, outputReserve: 4096, safetyMargin: 1024, pct: 0.85, absoluteBudget: 0 };

  it("context overflow with no explicit stack escalates through the available ladder", async () => {
    const lines = [];
    const out = await seam({}, overflow, { debug: (...a) => lines.push(a.join(" ")) });
    expect(engineList(out).split(",")).toEqual(expect.arrayContaining(["session-dedup", "caveman"]));
    expect(lines.join("\n")).toMatch(/adaptive reserve-output target=2880 .*fit=false/);
  });

  it("an explicit global stack wins over replace-autotrigger", async () => {
    const out = await seam({ caveman: { enabled: true } }, overflow);
    expect(engineList(out)).toBe("caveman");
  });

  it("floor escalates beyond the explicit stack, but only into dispatchable engines", async () => {
    const lines = [];
    const out = await seam({ "session-dedup": { enabled: true } }, { ...overflow, mode: "floor" }, { debug: (...a) => lines.push(a.join(" ")) });
    // A stacked base plan sits at the prose tier; only aggressive/ultra lie
    // beyond it and both are catalog placeholders, so nothing is added and the
    // resolver reports fit=false instead of crediting engines that cannot run.
    expect(engineList(out)).toBe("session-dedup");
    expect(lines.join("\n")).toMatch(/stages=none fit=false/);
  });

  it("never escalates when the request already fits", async () => {
    const out = await seam({}, { ...overflow, modelContextLimit: 1_000_000 });
    expect(out.headerValue).toBeNull();
  });

  it("an unknown context limit skips adaptive and never claims fit", async () => {
    const lines = [];
    const out = await seam({}, { ...overflow, modelContextLimit: null }, { debug: (...a) => lines.push(a.join(" ")) });
    expect(out.headerValue).toBeNull();
    expect(lines).toEqual([]);
  });

  it("mode off keeps only the global plan", async () => {
    const out = await seam({ caveman: { enabled: true } }, { ...overflow, mode: "off" });
    expect(engineList(out)).toBe("caveman");
  });
});
