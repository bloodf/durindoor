import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildJevState, classifyTask, reorderByTaskWeight } from "../../open-sse/services/combo.js";
import { classifyTier, resetJevBreaker } from "../../open-sse/services/jevClassifier.js";
import { JEV_TIERS, JEV_TIER_TO_TASK_LEVEL } from "../../open-sse/config/jev.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Jev HTTP-200 stub carrying the given answers.tier shape.
function jevOk({ choice, confidence = 1, probabilities, model = "jev-1.13.0", usage = { input_tokens: 400, output_tokens: 50 } }) {
  const json = {
    model,
    answers: { tier: { type: "choice", choice, confidence, probabilities: probabilities || { [choice]: confidence } } },
    usage,
  };
  return { ok: true, status: 200, json: async () => json };
}
function jevHttp(status = 500) {
  return { ok: false, status, json: async () => ({ error: { message: "boom" } }) };
}

// ---------------------------------------------------------------------------
// buildJevState — bounded, current-turn-only
// ---------------------------------------------------------------------------
describe("buildJevState", () => {
  it("uses the trailing user turn only (OpenAI shape)", () => {
    const body = { messages: [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current ask" },
    ] };
    expect(buildJevState(body)).toBe("current ask");
  });

  it("extracts text from Claude content-block arrays", () => {
    const body = { messages: [
      { role: "user", content: [{ type: "text", text: "fix the race" }, { type: "image", source: {} }] },
    ] };
    expect(buildJevState(body)).toBe("fix the race");
  });

  it("reads Gemini contents/parts", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "gemini ask" }] }] };
    expect(buildJevState(body)).toBe("gemini ask");
  });

  it("reads the Responses input array", () => {
    const body = { input: [{ role: "user", content: [{ type: "input_text", text: "responses ask" }] }] };
    expect(buildJevState(body)).toBe("responses ask");
  });

  it("bounds the state to the char budget", () => {
    const body = { messages: [{ role: "user", content: "x".repeat(10000) }] };
    expect(buildJevState(body, 4000)).toHaveLength(4000);
  });

  it("returns '' for an empty/absent ask", () => {
    expect(buildJevState({ messages: [] })).toBe("");
    expect(buildJevState({})).toBe("");
    expect(buildJevState(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// tier -> task level bridge
// ---------------------------------------------------------------------------
describe("JEV_TIER_TO_TASK_LEVEL", () => {
  it("maps every tier onto a level the task scorer understands", () => {
    const known = new Set(["light", "standard", "heavy", "critical"]);
    for (const tier of JEV_TIERS) {
      expect(known.has(JEV_TIER_TO_TASK_LEVEL[tier])).toBe(true);
    }
  });

  it("a REASONING tier outranks a SIMPLE tier when ordering the same combo", () => {
    const models = ["cheap/haiku-3.5", "strong/claude-opus-4-5"];
    const base = classifyTask({ messages: [{ role: "user", content: "hello" }] });
    const simple = reorderByTaskWeight(models, { ...base, level: JEV_TIER_TO_TASK_LEVEL.SIMPLE, weight: 1 });
    const reasoning = reorderByTaskWeight(models, { ...base, level: JEV_TIER_TO_TASK_LEVEL.REASONING, weight: 4 });
    expect(simple[0]).toBe("cheap/haiku-3.5");
    expect(reasoning[0]).toBe("strong/claude-opus-4-5");
    // Never drops a member: the fallback ladder stays complete.
    expect(new Set(reasoning)).toEqual(new Set(models));
  });
});

// ---------------------------------------------------------------------------
// classifyTier — fail-open matrix (all offline via injected fetchImpl)
// ---------------------------------------------------------------------------
describe("classifyTier", () => {
  beforeEach(() => resetJevBreaker());

  const baseOpts = {
    state: "write a function",
    log,
    apiKey: "test-key",
    fetchImpl: vi.fn(async () => jevOk({ choice: "MEDIUM", confidence: 0.99 })),
  };

  it("returns the tier, confidence and spend on a confident 200", async () => {
    const fetchImpl = vi.fn(async () => jevOk({ choice: "MEDIUM", confidence: 0.99 }));
    const r = await classifyTier({ ...baseOpts, fetchImpl });
    expect(r).toMatchObject({ tier: "MEDIUM", confidence: 0.99, source: "jev", model: "jev-1.13.0" });
    expect(JEV_TIERS).toContain(r.tier);
    // spend = 400/1e6 * 0.042 + 50/1e6 * 0 = 0.0000168
    expect(r.spendUsd).toBeCloseTo(0.0000168, 10);
    // POSTed to /v1/systemone with a Bearer header and a single choice question.
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body).questions.tier.type).toBe("choice");
  });

  it("fails open (null) when no API key is configured", async () => {
    const fetchImpl = vi.fn();
    const r = await classifyTier({ ...baseOpts, apiKey: undefined, fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails open (null) on an empty state without calling Jev", async () => {
    const fetchImpl = vi.fn();
    const r = await classifyTier({ ...baseOpts, state: "", fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails open (null) on a non-200 HTTP response", async () => {
    const r = await classifyTier({ ...baseOpts, fetchImpl: vi.fn(async () => jevHttp(503)) });
    expect(r).toBeNull();
  });

  it("fails open (null) on an unparseable response body", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
    const r = await classifyTier({ ...baseOpts, fetchImpl });
    expect(r).toBeNull();
  });

  it("fails open (null) on an unknown tier", async () => {
    const r = await classifyTier({ ...baseOpts, fetchImpl: vi.fn(async () => jevOk({ choice: "GALACTIC", confidence: 1 })) });
    expect(r).toBeNull();
  });

  it("fails open (null) when confidence is below the threshold", async () => {
    const fetchImpl = vi.fn(async () => jevOk({ choice: "MEDIUM", confidence: 0.2 }));
    const r = await classifyTier({ ...baseOpts, minConfidence: 0.5, fetchImpl });
    expect(r).toBeNull();
  });

  it("honours a custom minConfidence", async () => {
    const fetchImpl = vi.fn(async () => jevOk({ choice: "SIMPLE", confidence: 0.2 }));
    const r = await classifyTier({ ...baseOpts, minConfidence: 0.1, fetchImpl });
    expect(r?.tier).toBe("SIMPLE");
  });

  it("fails open (null) on a timeout and trips the breaker", async () => {
    const clock = 0;
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    // fetchImpl never resolves on its own; the AbortController fires the timeout.
    const fetchImpl = vi.fn(() => new Promise((_, reject) => setTimeout(() => reject(abortErr), 50)));
    const r = await classifyTier({ ...baseOpts, fetchImpl, timeoutMs: 5, now: () => clock });
    expect(r).toBeNull();

    // Breaker is now open: a second call is skipped WITHOUT hitting fetch.
    const fetch2 = vi.fn();
    const r2 = await classifyTier({ ...baseOpts, fetchImpl: fetch2, timeoutMs: 5, now: () => clock + 1000 });
    expect(r2).toBeNull();
    expect(fetch2).not.toHaveBeenCalled();
  });

  it("lets one probe through after the breaker cooldown, then closes on success", async () => {
    let clock = 0;
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const slow = vi.fn(() => new Promise((_, reject) => setTimeout(() => reject(abortErr), 50)));
    await classifyTier({ ...baseOpts, fetchImpl: slow, timeoutMs: 5, now: () => clock });

    // Advance past the 30s cooldown: the half-open probe is allowed.
    clock += 31000;
    const probe = vi.fn(async () => jevOk({ choice: "COMPLEX", confidence: 0.9 }));
    const r = await classifyTier({ ...baseOpts, fetchImpl: probe, timeoutMs: 50, now: () => clock });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(r?.tier).toBe("COMPLEX");
  });

  it("never leaks the API key into the returned object or the logs", async () => {
    const lines = [];
    const spyLog = {
      info: (tag, m) => lines.push(String(m)),
      warn: (tag, m) => lines.push(String(m)),
      debug: (tag, m) => lines.push(String(m)),
    };
    const r = await classifyTier({ ...baseOpts, log: spyLog, fetchImpl: vi.fn(async () => jevOk({ choice: "MEDIUM", confidence: 0.99 })) });
    expect(JSON.stringify(r)).not.toContain("test-key");
    expect(lines.join("\n")).not.toContain("test-key");
  });
});
