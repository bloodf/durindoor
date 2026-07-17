import { describe, it, expect } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const fakeLog = { info: () => {}, warn: () => {}, error: () => {} };

const makeOkResponse = (text = "ok") => {
  const body = JSON.stringify({ choices: [{ message: { content: text } }] });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
};

const makeAbortResponse = () => new Response(null, { status: 499 });

describe("combo per-model timeout", () => {
  it("returns immediately when timeout is 0 and first model succeeds", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1", "a/model-2"],
      handleSingleModel: async () => {
        calls++;
        return makeOkResponse("fast");
      },
      log: fakeLog,
      comboName: "combo-fast",
      comboStrategy: "fallback",
      comboTimeoutMs: 0,
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("fast");
    expect(calls).toBe(1);
  });

  it("falls back to the next model when the timeout fires before the first response", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/slow", "a/fast"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/slow") {
          await new Promise((r) => setTimeout(r, 50));
          return makeOkResponse("slow");
        }
        return makeOkResponse("fast");
      },
      log: fakeLog,
      comboName: "combo-timeout",
      comboStrategy: "fallback",
      comboTimeoutMs: 10,
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("fast");
    expect(calls).toBe(2);
  });

  it("falls back when a slow model returns a 499 Response after the abort signal fires", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/late-abort", "a/fast"],
      handleSingleModel: async (body, model, signal) => {
        calls++;
        if (model === "a/late-abort") {
          await new Promise((r) => setTimeout(r, 30));
          // The handler sees the abort signal and returns a 499 instead of throwing.
          if (signal?.aborted) return makeAbortResponse();
          return makeOkResponse("late");
        }
        return makeOkResponse("fast");
      },
      log: fakeLog,
      comboName: "combo-499",
      comboStrategy: "fallback",
      comboTimeoutMs: 10,
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("fast");
    expect(calls).toBe(2);
  });

  it("does not pollute lastError with the timeout message", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/slow", "a/fails"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/slow") {
          await new Promise((r) => setTimeout(r, 50));
          return makeOkResponse("slow");
        }
        return new Response(JSON.stringify({ error: { message: "real error" } }), { status: 500 });
      },
      log: fakeLog,
      comboName: "combo-last-error",
      comboStrategy: "fallback",
      comboTimeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    const json = await result.json();
    expect(json.error.message).toBe("real error");
    expect(calls).toBe(2);
  });

  it("clears the timer when a fast response wins the race", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/fast"],
      handleSingleModel: async () => {
        calls++;
        return makeOkResponse("fast");
      },
      log: fakeLog,
      comboName: "combo-no-leak",
      comboStrategy: "fallback",
      comboTimeoutMs: 10,
    });

    expect(result.ok).toBe(true);
    // Allow a small tick to ensure no unhandled rejections from the timer.
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
  });
});
