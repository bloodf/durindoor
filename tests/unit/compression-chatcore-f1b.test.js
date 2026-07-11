// F-1b chatCore compression wiring — exercised against the REAL F-1a modules
// (feat/compression-stack). Covers the binding contract end-to-end:
//   - enabled + available real engine mutates the body
//   - apply receives { config, stepConfig } for BOTH single and stacked modes
//   - per-engine fail-open: first engine succeeds, second throws -> first kept
//   - disabled => passthrough (and does not import/touch engines)
//   - planning-throw / unavailable-id => passthrough
import "../translator/registerAll.js";
import { describe, it, expect } from "vitest";
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";
import {
  getEngine,
  isEngineAvailable,
  planToEngineIds,
} from "../../open-sse/services/compression/index.js";
import { deriveDefaultPlan } from "../../open-sse/services/compression/deriveDefaultPlan.js";
import { resolveAdaptivePlan } from "../../open-sse/services/compression/adaptiveCompression/resolveAdaptivePlan.js";
import { enginesFromV2Settings } from "../../src/sse/handlers/compressionFactory.js";

const body = () => ({
  messages: [
    { role: "system", content: "you are a helpful assistant" },
    { role: "user", content: "hello world, this is a test prompt with some repeated words repeated words" },
  ],
});

const realDeps = { getEngine, isEngineAvailable, planToEngineIds, deriveDefaultPlan, resolveAdaptivePlan };

describe("runCompressionSeam (real F-1a modules)", () => {
  it("disabled passthrough returns same reference and touches nothing", async () => {
    const b = body();
    const out = await runCompressionSeam(b, realDeps, { enabled: false });
    expect(out).toBe(b);
  });

  it("enabled single-mode (caveman) dispatches and mutates body", async () => {
    const b = body();
    const out = await runCompressionSeam(b, realDeps, {
      enabled: true,
      engines: enginesFromV2Settings("caveman", []),
      applyOpts: { format: "openai-chat", model: "gpt-4o", provider: "openai" },
    });
    expect(out).not.toBe(b);
    expect(JSON.stringify(out)).not.toEqual(JSON.stringify(b));
  });

  it("single-mode apply receives { config, stepConfig:{engine} }", async () => {
    const seen = [];
    const deps = {
      ...realDeps,
      isEngineAvailable: () => true,
      getEngine: (id) => ({
        apply: async (b, opts) => {
          seen.push({ id, opts });
          return { body: { ...b, _t: id }, compressed: true, stats: { savingsPercent: 1 } };
        },
      }),
      planToEngineIds: () => ["caveman"],
    };
    await runCompressionSeam(body(), deps, {
      enabled: true,
      engines: { caveman: { enabled: true } },
      applyOpts: { format: "f", model: "m", provider: "p" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].opts.config).toEqual({ format: "f", model: "m", provider: "p" });
    expect(seen[0].opts.stepConfig).toEqual({ engine: "caveman" });
  });

  it("stacked-mode apply receives planner step with intensity in stepConfig", async () => {
    const seen = [];
    const deps = {
      ...realDeps,
      isEngineAvailable: () => true,
      getEngine: (id) => ({
        apply: async (b, opts) => {
          seen.push({ id, opts });
          return { body: b, compressed: true, stats: { savingsPercent: 0 } };
        },
      }),
    };
    const engines = enginesFromV2Settings("stacked", [
      { engine: "caveman", intensity: 5 },
      { engine: "session-dedup", intensity: 3 },
    ]);
    await runCompressionSeam(body(), deps, { enabled: true, engines });
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const s of seen) {
      expect(s.opts.stepConfig).toBeDefined();
      expect(s.opts.stepConfig.engine).toBe(s.id);
    }
    const cavemanSeen = seen.find((s) => s.id === "caveman");
    if (cavemanSeen) expect(cavemanSeen.opts.stepConfig.intensity).toBe(5);
  });

  it("per-engine fail-open: first success retained when second throws", async () => {
    const deps = {
      ...realDeps,
      isEngineAvailable: () => true,
      planToEngineIds: () => ["good", "bad"],
      getEngine: (id) => ({
        apply: async (b) => {
          if (id === "bad") throw new Error("boom");
          return { body: { ...b, _good: true }, compressed: true, stats: { savingsPercent: 1 } };
        },
      }),
    };
    const out = await runCompressionSeam(body(), deps, { enabled: true, engines: { good: { enabled: true }, bad: { enabled: true } } });
    expect(out._good).toBe(true);
  });

  it("unavailable engine is skipped (no throw, body unchanged)", async () => {
    const deps = {
      ...realDeps,
      isEngineAvailable: () => false,
      planToEngineIds: () => ["caveman"],
      getEngine: () => { throw new Error("should not be called"); },
    };
    const b = body();
    const out = await runCompressionSeam(b, deps, { enabled: true, engines: { caveman: { enabled: true } } });
    expect(out).toBe(b);
  });

  it("plan derivation throw -> original body returned", async () => {
    const deps = {
      ...realDeps,
      deriveDefaultPlan: () => { throw new Error("planner broke"); },
    };
    const b = body();
    const out = await runCompressionSeam(b, deps, { enabled: true, engines: { caveman: { enabled: true } } });
    expect(out).toBe(b);
  });
});
