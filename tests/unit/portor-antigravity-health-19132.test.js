import { describe, it, expect } from "vitest";
import { AntigravityHealthTracker, HEALTH_POLICY, healthEnabled, trackHealthResponse } from "../../open-sse/services/antigravityHealth.js";

describe("Antigravity adaptive health", () => {
  it("requires completed timeout samples and separates accounts and models", () => {
    const tracker = new AntigravityHealthTracker(() => 1000);
    for (let i = 0; i < 7; i++) tracker.begin("a", "model").finish("timeout");
    for (let i = 0; i < 20; i++) tracker.begin("a", "model").finish("ignored");
    expect(tracker.candidates([{ id: "a" }, { id: "b" }], "model")).toHaveLength(2);
    tracker.begin("a", "model").finish("timeout");
    expect(tracker.candidates([{ id: "a" }, { id: "b" }], "model")).toEqual([{ id: "b" }]);
    expect(tracker.candidates([{ id: "a" }, { id: "b" }], "other")).toHaveLength(2);
    expect(tracker.candidates([{ id: "a" }], "model", true)).toEqual([{ id: "a" }]);
  });
  it("claims one probe and releases it on ignored outcomes and recovery", () => {
    let now = 1000;
    const tracker = new AntigravityHealthTracker(() => now);
    for (let i = 0; i < 8; i++) tracker.begin("a", "model").finish("timeout");
    now += HEALTH_POLICY.baseCooldown + 1;
    const probe = tracker.begin("a", "model");
    expect(probe.probe).toBe(true);
    expect(tracker.begin("a", "model")).toBeNull();
    probe.finish("ignored");
    tracker.begin("a", "model").finish("success");
    tracker.begin("a", "model").finish("success");
    expect(tracker.entries.get(tracker.key("a", "model")).backoff).toBe(0);
  });
  it("caps state and honors a stored switch over the environment", () => {
    const tracker = new AntigravityHealthTracker();
    for (let i = 0; i < 1100; i++) tracker.begin(String(i), "model").finish("success");
    expect(tracker.entries.size).toBeLessThanOrEqual(HEALTH_POLICY.maxEntries);
    const prior = process.env.DURINDOOR_ANTIGRAVITY_ADAPTIVE_HEALTH_ENABLED;
    process.env.DURINDOOR_ANTIGRAVITY_ADAPTIVE_HEALTH_ENABLED = "true";
    expect(healthEnabled("antigravity", {})).toBe(true);
    expect(healthEnabled("agy", { antigravityAdaptiveHealth: { enabled: false } })).toBe(false);
    expect(healthEnabled("other", { antigravityAdaptiveHealth: { enabled: true } })).toBe(false);
    if (prior === undefined) delete process.env.DURINDOOR_ANTIGRAVITY_ADAPTIVE_HEALTH_ENABLED; else process.env.DURINDOOR_ANTIGRAVITY_ADAPTIVE_HEALTH_ENABLED = prior;
  });
  it("keeps selection inside the supplied pool and releases an aborted probe", async () => {
    const tracker = new AntigravityHealthTracker(() => 1000);
    for (let i = 0; i < 8; i++) tracker.begin("a", "model").finish("timeout");
    expect(tracker.candidates([], "model")).toEqual([]);
    expect(tracker.candidates([{ id: "a" }], "model")).toEqual([{ id: "a" }]);
    const controller = new AbortController();
    const response = trackHealthResponse(new Response(new ReadableStream()), tracker.begin("a", "model", true), controller.signal);
    controller.abort();
    await response.body.cancel();
    expect(tracker.entries.get(tracker.key("a", "model")).probe).toBe(false);
    expect(tracker.entries.get(tracker.key("a", "model")).samples).toHaveLength(8);
  });
  it("records only completed useful responses and releases cancelled streams", async () => {
    const tracker = new AntigravityHealthTracker();
    const good = trackHealthResponse(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'), tracker.begin("good", "model"));
    await good.text();
    expect(tracker.entries.get(tracker.key("good", "model")).samples).toHaveLength(1);
    const bad = trackHealthResponse(new Response('data: {"error":{"message":"failed"}}\n\n'), tracker.begin("bad", "model"));
    await bad.text();
    expect(tracker.entries.get(tracker.key("bad", "model")).samples).toHaveLength(0);
    const cancelled = trackHealthResponse(new Response(new ReadableStream()), tracker.begin("cancel", "model"));
    await cancelled.body.cancel();
    expect(tracker.entries.get(tracker.key("cancel", "model")).inflight).toBe(0);
  });
});
