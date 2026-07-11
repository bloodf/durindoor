import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  handleComboChat,
  handleFusionChat,
  comboConversationAffinity,
  splitFingerprintPin,
  FP_PIN_SEPARATOR,
  MODEL_FAMILIES,
  AUTO_FAMILY_IDS,
  detectModelFamily,
  isValidModelFamily,
  getConversationCacheKey,
} from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

function okResponse(content) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  return make();
}

function errResponse(status = 503, message = "boom") {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({ error: { message } }) });
  return make();
}

beforeEach(() => {
  comboConversationAffinity.clear();
});

describe("#6546 empty pool fail-fast", () => {
  it("returns 503 immediately for an empty combo model list", async () => {
    const handleSingleModel = vi.fn();
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: [],
      handleSingleModel,
      log,
      comboName: "empty",
      comboStrategy: "fallback",
    });
    expect(handleSingleModel).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });
});

describe("quota-aware combo ordering", () => {
  it("applies the shared quota order after legacy strategy routing", async () => {
    const seen = [];
    const quotaRanker = vi.fn(async () => ["p/high", "p/low"]);
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/low", "p/high"],
      handleSingleModel: async (_body, model) => {
        seen.push(model);
        return okResponse(model);
      },
      log,
      comboName: "quota",
      comboStrategy: "fallback",
      quotaRanker,
    });
    expect(response.ok).toBe(true);
    expect(seen).toEqual(["p/high"]);
    expect(quotaRanker).toHaveBeenCalledWith(["p/low", "p/high"]);
  });

  it("preserves legacy order when quota ranking is unavailable", async () => {
    const seen = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/first", "p/second"],
      handleSingleModel: async (_body, model) => {
        seen.push(model);
        return okResponse(model);
      },
      log,
      comboName: "quota-unavailable",
      comboStrategy: "fallback",
      quotaRanker: async () => { throw new Error("repository unavailable"); },
    });
    expect(seen).toEqual(["p/first"]);
  });

  it("cancels a transient fallback cooldown without invoking the next model", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const handleSingleModel = vi.fn(async (_body, model) => (
        model === "p/first" ? errResponse(503) : okResponse(model)
      ));
      const pending = handleComboChat({
        body: { messages: [{ role: "user", content: "hi" }] },
        models: ["p/first", "p/second"],
        handleSingleModel,
        log,
        comboName: "abort-cooldown",
        comboStrategy: "fallback",
        signal: controller.signal,
      });
      await Promise.resolve();
      expect(handleSingleModel).toHaveBeenCalledTimes(1);

      controller.abort();
      const response = await pending;
      expect(response.status).toBe(499);
      expect(handleSingleModel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("#6696 fingerprint pin parser", () => {
  it("splits a composite pin into realConnectionId + pinnedFingerprint", () => {
    expect(FP_PIN_SEPARATOR).toBe("|fp|");
    expect(splitFingerprintPin("row-123|fp|FP-abc")).toEqual({
      realConnectionId: "row-123",
      pinnedFingerprint: "FP-abc",
    });
  });

  it("returns null when there is no separator or a part is empty", () => {
    expect(splitFingerprintPin("row-123")).toBeNull();
    expect(splitFingerprintPin("|fp|FP-abc")).toBeNull();
    expect(splitFingerprintPin("row-123|fp|")).toBeNull();
    expect(splitFingerprintPin(42)).toBeNull();
  });

  it("uses the first separator (matches upstream indexOf semantics)", () => {
    expect(splitFingerprintPin("row|fp|FP|fp|EXTRA")).toEqual({
      realConnectionId: "row",
      pinnedFingerprint: "FP|fp|EXTRA",
    });
  });
});

describe("#6733 release stickiness pin on first-member failure", () => {
  const body = { messages: [{ role: "user", content: "hello" }] };

  it("deletes the affinity pin when the pinned first member falls back (response path)", async () => {
    const models = ["p/a", "p/b"];
    const key = `__default__:${getConversationCacheKey(body)}`;
    comboConversationAffinity.set(key, { index: 0, lastUsed: Date.now() }); // pinned to models[0] = p/a

    const handleSingleModel = vi.fn(async (_b, m) => (m === "p/a" ? errResponse(503) : okResponse("ok-b")));
    const res = await handleComboChat({
      body, models, handleSingleModel, log,
      comboStrategy: "round-robin", comboStickyLimit: 2, autoSwitch: false,
    });

    expect(res.status).toBe(200);
    expect(comboConversationAffinity.has(key)).toBe(false); // pin released
    expect(handleSingleModel.mock.calls.map((c) => c[1])).toEqual(["p/a", "p/b"]);
  });

  it("deletes the affinity pin when the pinned first member throws (catch path)", async () => {
    const models = ["p/a", "p/b"];
    const key = `__default__:${getConversationCacheKey(body)}`;
    comboConversationAffinity.set(key, { index: 0, lastUsed: Date.now() });

    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "p/a") throw new Error("network");
      return okResponse("ok-b");
    });
    const res = await handleComboChat({
      body, models, handleSingleModel, log,
      comboStrategy: "round-robin", comboStickyLimit: 2, autoSwitch: false,
    });

    expect(res.status).toBe(200);
    expect(comboConversationAffinity.has(key)).toBe(false);
  });

  it("does NOT delete the pin on a non-fallback response (request did not fall over)", async () => {
    const models = ["p/a", "p/b"];
    const key = `__default__:${getConversationCacheKey(body)}`;
    comboConversationAffinity.set(key, { index: 0, lastUsed: Date.now() });

    // provider_port_pending is the explicit no-fallback marker → handleComboChat
    // returns it directly without advancing, so the pin must be retained.
    const handleSingleModel = vi.fn(async () => errResponse(501, "provider_port_pending: not wired"));
    const res = await handleComboChat({
      body, models, handleSingleModel, log,
      comboStrategy: "round-robin", comboStickyLimit: 2, autoSwitch: false,
    });

    expect(res.status).toBe(501);
    expect(comboConversationAffinity.has(key)).toBe(true); // pin retained
  });

  it("does not delete when the stored index maps to a different model (race guard)", async () => {
    const models = ["p/a", "p/b"];
    const key = `__default__:${getConversationCacheKey(body)}`;
    comboConversationAffinity.set(key, { index: 1, lastUsed: Date.now() }); // pinned to models[1] = p/b

    const handleSingleModel = vi.fn(async (_b, m) => (m === "p/a" ? errResponse(503) : okResponse("ok-b")));
    await handleComboChat({
      body, models, handleSingleModel, log,
      comboStrategy: "round-robin", comboStickyLimit: 2, autoSwitch: false,
    });

    // rotatedModels[0] === models[0] === p/a (index 0). Stored pin index=1 → p/b.
    // Failed member is p/a, but pin points at p/b → must NOT delete.
    expect(comboConversationAffinity.has(key)).toBe(true);
  });
});

describe("#6521 minPanel floor is 1 (not 2)", () => {
  it("a 2-model panel proceeds once a single answer arrives (minPanel clamped to 1)", async () => {
    const handleSingleModel = vi.fn(async (_b, m, isPanel, signal) => {
      if (m === "j/judge") return okResponse("FINAL");
      if (m === "p/fast") return okResponse("fast-ans");
      // p/slow acknowledges cancellation only after its request cleanup path.
      return new Promise((_resolve, reject) => {
        if (!isPanel) return;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/fast", "p/slow"],
      handleSingleModel,
      log,
      judgeModel: "j/judge",
      tuning: { minPanel: 1, stragglerGraceMs: 5, panelHardTimeoutMs: 50 },
    });

    expect(res.status).toBe(200);
    // Judge was called (proves we did not wait for the slow member).
    expect(handleSingleModel.mock.calls.some((c) => c[1] === "j/judge")).toBe(true);
  });
});

describe("#6607 single survivor honors explicit judge", () => {
  it("one-member panel routes through explicit judgeModel instead of answering directly", async () => {
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "j/judge") return okResponse("JUDGED");
      return okResponse("panel-ans");
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/only"],
      handleSingleModel,
      log,
      judgeModel: "j/judge",
    });

    expect(res.status).toBe(200);
    const seen = handleSingleModel.mock.calls.map((c) => c[1]);
    expect(seen).toContain("p/only"); // panel-of-one was queried
    expect(seen[seen.length - 1]).toBe("j/judge"); // judge produced the final answer
  });

  it("multi-model panel with one survivor still invokes the explicit judge", async () => {
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "j/judge") return okResponse("JUDGED");
      if (m === "p/live") return okResponse("live-ans");
      return errResponse(500); // p/dead fails → only one survivor
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/live", "p/dead"],
      handleSingleModel,
      log,
      judgeModel: "j/judge",
    });

    expect(res.status).toBe(200);
    expect(handleSingleModel.mock.calls.some((c) => c[1] === "j/judge")).toBe(true);
  });

  it("without explicit judgeModel, a single survivor answers directly (cheap shortcut)", async () => {
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "p/live") return okResponse("live-ans");
      return errResponse(500);
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/live", "p/dead"],
      handleSingleModel,
      log,
      // no judgeModel
    });

    expect(res.status).toBe(200);
    // No extra judge call: p/live called for the panel, then re-answered directly.
    expect(handleSingleModel.mock.calls.every((c) => c[1] === "p/live" || c[1] === "p/dead")).toBe(true);
  });
});

describe("model-family helpers (#6509 / #6453)", () => {
  it("exposes the ordered family list and auto/<family> catalog ids", () => {
    expect([...MODEL_FAMILIES]).toEqual(["glm", "minimax", "mimo", "zai", "gemma", "llama", "gemini"]);
    expect([...AUTO_FAMILY_IDS]).toEqual([
      "auto/glm", "auto/minimax", "auto/mimo", "auto/zai", "auto/gemma", "auto/llama", "auto/gemini",
    ]);
  });

  it("detects family from the bare model id, ignoring provider prefix", () => {
    expect(detectModelFamily("glm-5.2")).toBe("glm");
    expect(detectModelFamily("zai/glm-5.2")).toBe("glm");
    expect(detectModelFamily("google/gemma-4-27b")).toBe("gemma");
    expect(detectModelFamily("meta/llama-3-70b")).toBe("llama");
    expect(detectModelFamily("gemini-2.5-pro")).toBe("gemini");
    expect(detectModelFamily("minimax-m2")).toBe("minimax");
    expect(detectModelFamily("mimo-v1")).toBe("mimo");
  });

  it("zai is a valid family but never detected from a model id", () => {
    expect(isValidModelFamily("zai")).toBe(true);
    expect(detectModelFamily("zai")).toBeNull();
    expect(detectModelFamily("zai/glm-5.2")).toBe("glm"); // model-id wins
  });

  it("returns null for unknown / empty input", () => {
    expect(detectModelFamily("claude-sonnet-5")).toBeNull();
    expect(detectModelFamily("")).toBeNull();
    expect(detectModelFamily(null)).toBeNull();
    expect(isValidModelFamily("nope")).toBe(false);
  });
});
