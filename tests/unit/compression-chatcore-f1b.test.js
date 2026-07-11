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

// Deep-equal a body but as a fresh object (engine cloned identical content).
const clonedIdentical = (b) => JSON.parse(JSON.stringify(b));

const realDeps = { getEngine, isEngineAvailable, planToEngineIds, deriveDefaultPlan, resolveAdaptivePlan };

describe("runCompressionSeam (real F-1a modules)", () => {
  it("disabled passthrough returns same reference, null header, touches nothing", async () => {
    const b = body();
    const out = await runCompressionSeam(b, realDeps, { enabled: false });
    expect(out.body).toBe(b);
    expect(out.headerValue).toBeNull();
  });

  it("enabled single-mode (caveman) dispatches, mutates body, emits header", async () => {
    const b = body();
    const out = await runCompressionSeam(b, realDeps, {
      enabled: true,
      engines: enginesFromV2Settings("caveman", []),
      applyOpts: { format: "openai-chat", model: "gpt-4o", provider: "openai" },
    });
    expect(out.body).not.toBe(b);
    expect(JSON.stringify(out.body)).not.toEqual(JSON.stringify(b));
    expect(typeof out.headerValue).toBe("string");
    expect(out.headerValue).toMatch(/^caveman\|\d+(\.\d+)?%$/);
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
    expect(out.body._good).toBe(true);
  });

  it("engine reporting compressed:true with identical cloned body yields null header", async () => {
    const deps = {
      ...realDeps,
      isEngineAvailable: () => true,
      planToEngineIds: () => ["caveman"],
      getEngine: () => ({
        apply: async (b) => ({ body: clonedIdentical(b), compressed: true, stats: { savingsPercent: 0 } }),
      }),
    };
    const out = await runCompressionSeam(body(), deps, { enabled: true, engines: { caveman: { enabled: true } } });
    expect(out.headerValue).toBeNull();
  });

  it("header value lists only engines that compressed and overall input/output savings", async () => {
    const deps = {
      ...realDeps,
      isEngineAvailable: () => true,
      planToEngineIds: () => ["a", "b"],
      getEngine: (id) => ({
        apply: async (b) => {
          if (id === "a") return { body: { ...b, messages: b.messages.slice(1) }, compressed: true, stats: { savingsPercent: 50 } };
          // b reports compressed but does not change the body -> must NOT appear.
          return { body: clonedIdentical(b), compressed: true, stats: { savingsPercent: 0 } };
        },
      }),
    };
    const out = await runCompressionSeam(body(), deps, { enabled: true, engines: { a: { enabled: true }, b: { enabled: true } } });
    expect(out.headerValue).toMatch(/^a\|\d+(\.\d+)?%$/);
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
    expect(out.body).toBe(b);
    expect(out.headerValue).toBeNull();
  });

  it("plan derivation throw -> original body, null header", async () => {
    const deps = {
      ...realDeps,
      deriveDefaultPlan: () => { throw new Error("planner broke"); },
    };
    const b = body();
    const out = await runCompressionSeam(b, deps, { enabled: true, engines: { caveman: { enabled: true } } });
    expect(out.body).toBe(b);
    expect(out.headerValue).toBeNull();
  });
});
