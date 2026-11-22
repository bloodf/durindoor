import { describe, expect, it, vi } from "vitest";
import { getRotatedModels, getWeightedModels, handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const makeJsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("combo weighted strategy with weight-0 members (#2171)", () => {
  it("never picks a weight-0 member before a positive-weight member across random draws", () => {
    const models = ["p/zero-a", "p/positive", "p/zero-b"];
    const members = [
      { id: "p/zero-a", weight: 0 },
      { id: "p/positive", weight: 0.25 },
      { id: "p/zero-b", weight: 0 },
    ];

    for (const draw of [0, 1e-9, 0.5, 0.999999]) {
      const ordered = getWeightedModels(models, members, () => draw);
      expect(ordered).toEqual(["p/positive", "p/zero-a", "p/zero-b"]);
    }

    const draws = [0.9999, 0.0001, 0.9999];
    let idx = 0;
    expect(getWeightedModels(models, members, () => draws[idx++])).toEqual([
      "p/positive",
      "p/zero-a",
      "p/zero-b",
    ]);
  });

  it("matches duplicate model occurrences so only weight-0 occurrences sort after positive-weight members", () => {
    const models = ["p/dup", "p/other", "p/dup"];
    const members = [
      { id: "p/dup", weight: 0 },
      { id: "p/other", weight: 1 },
      { id: "p/dup", weight: 100 },
    ];

    const ordered = getWeightedModels(models, members, () => 0.5);
    expect(ordered).toEqual(["p/dup", "p/other", "p/dup"]);
    expect(getRotatedModels(["p/zero", "p/pos"], "weighted-zero", "weighted", 1, null, [
      { id: "p/zero", weight: 0 },
      { id: "p/pos", weight: 1 },
    ])[0]).toBe("p/pos");
  });

  it("keeps weight-0 members eligible as fallback targets when positive-weight members fail", async () => {
    const attempted = [];
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hello" }] },
      models: ["p/zero", "p/primary"],
      comboMembers: [
        { id: "p/zero", weight: 0 },
        { id: "p/primary", weight: 1 },
      ],
      comboStrategy: "weighted",
      comboName: "weighted-zero-fallback",
      autoSwitch: false,
      handleSingleModel: async (_body, model) => {
        attempted.push(model);
        if (model === "p/primary") {
          return makeJsonResponse({ error: { message: "upstream unavailable" } }, 503);
        }
        return makeJsonResponse({ choices: [{ message: { content: "from-zero-fallback" } }] });
      },
      log,
    });

    expect(response.status).toBe(200);
    expect(attempted).toEqual(["p/primary", "p/zero"]);
    await expect(response.json()).resolves.toEqual({
      choices: [{ message: { content: "from-zero-fallback" } }],
    });
  });
});

describe("combo empty-body retry reuses attempt body, signal and timeout (#2172)", () => {
  it("passes the reasoning-buffered attemptBody and attemptSignal on the empty-body retry", async () => {
    const originalBody = {
      stream: false,
      max_tokens: 32000,
      messages: [{ role: "user", content: "hello" }],
    };
    const calls = [];

    const response = await handleComboChat({
      body: originalBody,
      models: ["glmt/glm-5.2"],
      comboName: "retry-buffered-body",
      comboStrategy: "fallback",
      autoSwitch: false,
      comboTimeoutMs: 500,
      handleSingleModel: async (attemptBody, model, attemptSignal) => {
        calls.push({ attemptBody, model, attemptSignal });
        if (calls.length === 1) {
          return makeJsonResponse({ choices: [{ message: { content: "" } }] });
        }
        return makeJsonResponse({ choices: [{ message: { content: "recovered" } }] });
      },
      log,
    });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].attemptBody.max_tokens).toBe(48000);
    expect(calls[1].attemptBody).toBe(calls[0].attemptBody);
    expect(calls[1].attemptBody.max_tokens).toBe(48000);
    expect(calls[0].attemptSignal).toBeInstanceOf(AbortSignal);
    expect(calls[1].attemptSignal).toBe(calls[0].attemptSignal);
    expect(originalBody.max_tokens).toBe(32000);
  });

  it("enforces comboTimeoutMs on the empty-body retry, aborts attemptSignal, and falls back without polluting lastError", async () => {
    const calls = [];

    const response = await handleComboChat({
      body: { stream: false, messages: [{ role: "user", content: "hello" }] },
      models: ["p/empty-then-slow", "p/fails"],
      comboName: "retry-timeout",
      comboStrategy: "fallback",
      autoSwitch: false,
      comboTimeoutMs: 15,
      handleSingleModel: async (_attemptBody, model, attemptSignal) => {
        calls.push({ model, attemptSignal });
        if (model === "p/empty-then-slow") {
          if (calls.length === 1) {
            return makeJsonResponse({ choices: [{ message: { content: "" } }] });
          }
          await new Promise((resolve) => setTimeout(resolve, 60));
          return makeJsonResponse({ choices: [{ message: { content: "too-late" } }] });
        }
        return makeJsonResponse({ error: { message: "second model error" } }, 500);
      },
      log,
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].model).toBe("p/empty-then-slow");
    expect(calls[1].model).toBe("p/empty-then-slow");
    expect(calls[1].attemptSignal).toBe(calls[0].attemptSignal);
    expect(calls[1].attemptSignal?.aborted).toBe(true);
    expect(calls[2].model).toBe("p/fails");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { message: "second model error" },
    });
  });

  it("falls back when the empty-body retry returns 499 after attemptSignal aborts", async () => {
    let attempts = 0;

    const response = await handleComboChat({
      body: { stream: false, messages: [{ role: "user", content: "hello" }] },
      models: ["p/empty-then-499", "p/fast"],
      comboName: "retry-499-timeout",
      comboStrategy: "fallback",
      autoSwitch: false,
      comboTimeoutMs: 15,
      handleSingleModel: async (_attemptBody, model, attemptSignal) => {
        attempts++;
        if (model === "p/empty-then-499") {
          if (attempts === 1) {
            return makeJsonResponse({ choices: [{ message: { content: "" } }] });
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (attemptSignal?.aborted) return new Response(null, { status: 499 });
          return makeJsonResponse({ choices: [{ message: { content: "late" } }] });
        }
        return makeJsonResponse({ choices: [{ message: { content: "fast-fallback" } }] });
      },
      log,
    });

    expect(response.status).toBe(200);
    expect(attempts).toBe(3);
    await expect(response.json()).resolves.toEqual({
      choices: [{ message: { content: "fast-fallback" } }],
    });
  });
});
