import { describe, it, expect, vi } from "vitest";

import { handleFusionChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Minimal OpenAI-chat Response stub with the .ok + .clone().json() surface the engine uses.
function okResponse(content, { delayMs = 0 } = {}) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  const res = make();
  return delayMs > 0 ? new Promise((r) => setTimeout(() => r(res), delayMs)) : res;
}

function errResponse(status = 500) {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({ error: { message: "boom" } }) });
  return make();
}

describe("fusion combo", () => {
  // #6495 / F-4: when the hide-paid toggle filters an all-paid fusion combo
  // down to an empty panel, handleFusionChat must fail fast (400) rather than
  // fall through to `panel[0]` === undefined and route a judge turn with no
  // model. The chat handler reaches here via `if (comboModels)` because an
  // empty array is truthy — so the engine guard is the load-bearing defense.
  it("returns 400 and never calls handleSingleModel when the panel is empty", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("should-not-run"));
    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: [],
      handleSingleModel,
      log,
      comboName: "all-paid-fusion",
    });
    expect(res.status).toBe(400);
    expect(handleSingleModel).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error.message).toMatch(/no models/i);
  });

  it("treats a null/undefined models arg as an empty panel (400)", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("should-not-run"));
    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: null,
      handleSingleModel,
      log,
    });
    expect(res.status).toBe(400);
    expect(handleSingleModel).not.toHaveBeenCalled();
  });

  it("answers directly with a single-model panel (nothing to fuse)", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("solo"));
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/only"],
      handleSingleModel,
      log,
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel.mock.calls[0][1]).toBe("p/only");
  });

  it("fans out to the panel then routes a synthesis turn to the judge", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (body, model, isPanel) => {
      seen.push(model);
      if (model === "p/judge") return okResponse("FINAL");
      return okResponse(`ans-${model}`);
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }], stream: true, tools: [{ name: "x" }] },
      models: ["p/a", "p/b", "p/c"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    // 3 panel calls + 1 judge call.
    expect(handleSingleModel).toHaveBeenCalledTimes(4);
    expect(seen.slice(0, 3).sort()).toEqual(["p/a", "p/b", "p/c"]);
    expect(seen[3]).toBe("p/judge");

    // Panel calls are non-streaming with tools stripped.
    for (const [body, model, isPanel] of handleSingleModel.mock.calls.filter(([, m]) => m !== "p/judge")) {
      expect(body.stream).toBe(false);
      expect(body.tools).toBeUndefined();
      expect(isPanel).toBe(true);
    }

    // Judge call carries every panel answer + keeps the client's stream flag.
    const [judgeBody, , isPanel] = handleSingleModel.mock.calls.find(([, m]) => m === "p/judge");
    const judgeText = judgeBody.messages.at(-1).content;
    expect(judgeText).toContain("ans-p/a");
    expect(judgeText).toContain("ans-p/b");
    expect(judgeText).toContain("ans-p/c");
    expect(judgeText).toContain("Source 1");
    expect(judgeBody.stream).toBe(true);
    expect(isPanel).toBeUndefined();

    expect(res.ok).toBe(true);
  });

  it("strips stream_options from panel requests but keeps it for the judge (#3024)", async () => {
    // DeepSeek rejects stream_options unless stream:true; Fusion panel calls
    // always run non-streaming, so stream_options must not leak into them.
    const seen = [];
    const handleSingleModel = vi.fn(async (body, model, isPanel) => {
      seen.push([model, isPanel, body]);
      if (model === "p/judge") return okResponse("FINAL");
      return okResponse(`ans-${model}`);
    });

    await handleFusionChat({
      body: {
        messages: [{ role: "user", content: "Q" }],
        stream: true,
        stream_options: { include_usage: true },
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    for (const [model, isPanel, body] of seen) {
      if (isPanel) expect(body.stream_options).toBeUndefined();
      else expect(body.stream_options).toEqual({ include_usage: true });
    }
  });

  it("defaults the judge to the first panel model when none is set", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (_body, model) => { seen.push(model); return okResponse(`ans-${model}`); });
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/first", "p/second"],
      handleSingleModel,
      log,
    });
    // Last call is the judge; defaults to panel[0].
    expect(seen.at(-1)).toBe("p/first");
  });

  it("proceeds on quorum without waiting for a straggler (grace window)", async () => {
    const handleSingleModel = vi.fn(async (_body, model, isPanel, signal) => {
      if (model === "p/slow" && isPanel) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (model === "p/judge") return okResponse("FINAL");
      return okResponse(`fast-${model}`);
    });

    const t0 = Date.now();
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/x", "p/y", "p/slow"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 10000 },
    });
    const elapsed = Date.now() - t0;

    // Two fast answers reach quorum; grace is 50ms, so we never wait ~5s for p/slow.
    expect(elapsed).toBeLessThan(2000);

    const judgeCall = handleSingleModel.mock.calls.find(([, m]) => m === "p/judge");
    const judgeText = judgeCall[0].messages.at(-1).content;
    expect(judgeText).toContain("fast-p/x");
    expect(judgeText).toContain("fast-p/y");
    expect(judgeText).not.toContain("slow");
  });

  it("routes the lone survivor through an explicit judge (#6607)", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => {
      if (model === "p/judge") return okResponse("judged-lone");
      if (model === "p/ok") return okResponse("lone");
      return errResponse(500);
    });
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/ok", "p/bad"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });
    // #6607: explicit judgeModel is honored even with a single surviving answer.
    const judged = handleSingleModel.mock.calls.some(([, m]) => m === "p/judge");
    expect(judged).toBe(true);
  });

  it("returns 503 when the whole panel fails", async () => {
    const handleSingleModel = vi.fn(async () => errResponse(500));
    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });
    expect(res.status).toBe(503);
  });

  it("maps tool and function results to user turns without changing mid-history assistants", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "find files" },
          { role: "assistant", content: "I will search." },
          { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "find" } }] },
          { role: "tool", tool_call_id: "c1", content: "['a.js']" },
          { role: "function", name: "describe", content: "a source file" },
          { role: "user", content: "describe it" }
        ],
        tools: [{ type: "function" }]
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge"
    });

    // Panel calls keep every turn but tool and function results become user prose.
    const panelCalls = handleSingleModel.mock.calls.filter(([,, isPanel]) => isPanel === true);
    expect(panelCalls.length).toBe(2);
    for (const [panelBody] of panelCalls) {
      expect(panelBody.tools).toBeUndefined();
      expect(panelBody.messages.length).toBe(6);
      expect(panelBody.messages[0]).toEqual({ role: "user", content: "find files" });
      expect(panelBody.messages[1]).toEqual({ role: "assistant", content: "I will search." });
      expect(panelBody.messages[2].tool_calls).toBeUndefined();
      expect(panelBody.messages[2].content).toContain("find");
      expect(panelBody.messages[3]).toEqual({ role: "user", content: "[Tool result: ['a.js']]" });
      expect(panelBody.messages[4]).toEqual({ role: "user", content: "[Tool result: a source file]" });
      expect(panelBody.messages[5]).toEqual({ role: "user", content: "describe it" });
    }

    // Judge call still receives the unmodified history + synthesis prompt.
    const judgeCall = handleSingleModel.mock.calls.find(([, m]) => m === "p/judge");
    expect(judgeCall).toBeDefined();
    const judgeBody = judgeCall[0];
    expect(judgeBody.messages.length).toBe(7); // original 6 + judge prompt turn
    expect(judgeBody.messages[2].tool_calls).toBeDefined();
    expect(judgeBody.messages[3].role).toBe("tool");
    expect(judgeBody.messages[4].role).toBe("function");
  });

  it("ends tool-terminated panel history on a user turn", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "find files" },
          { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "find" } }] },
          { role: "tool", tool_call_id: "c1", content: "['a.js']" },
        ],
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    for (const [panelBody] of handleSingleModel.mock.calls.filter(([,, isPanel]) => isPanel === true)) {
      expect(panelBody.messages.at(-1)).toEqual({ role: "user", content: "[Tool result: ['a.js']]" });
    }
  });

  it("closes a trailing assistant turn with a user turn before panel fan-out", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }, { role: "assistant", content: "partial" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    for (const [panelBody] of handleSingleModel.mock.calls.filter(([,, isPanel]) => isPanel === true)) {
      expect(panelBody.messages).toEqual([
        { role: "user", content: "Q" },
        { role: "assistant", content: "partial" },
        { role: "user", content: "Continue from where the previous assistant message left off." },
      ]);
    }
  });

  it("closes a trailing assistant turn in Responses input before panel fan-out", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: { input: [{ role: "user", content: "Q" }, { role: "assistant", content: "partial" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    for (const [panelBody] of handleSingleModel.mock.calls.filter(([,, isPanel]) => isPanel === true)) {
      expect(panelBody.input).toEqual([
        { role: "user", content: "Q" },
        { role: "assistant", content: "partial" },
        { role: "user", content: "Continue from where the previous assistant message left off." },
      ]);
    }
  });

  it("keeps user-ending panel history and closes all-assistant history with a user turn", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    const userEnding = [{ role: "user", content: "Q" }, { role: "assistant", content: "A" }, { role: "user", content: "follow-up" }];
    const assistantOnly = [{ role: "assistant", content: "partial" }];
    await handleFusionChat({
      body: { messages: userEnding },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });
    await handleFusionChat({
      body: { input: assistantOnly },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    const panelCalls = handleSingleModel.mock.calls.filter(([,, isPanel]) => isPanel === true);
    expect(panelCalls.slice(0, 2).map(([panelBody]) => panelBody.messages)).toEqual([userEnding, userEnding]);
    expect(panelCalls.slice(2).map(([panelBody]) => panelBody.input)).toEqual([
      [...assistantOnly, { role: "user", content: "Continue from where the previous assistant message left off." }],
      [...assistantOnly, { role: "user", content: "Continue from where the previous assistant message left off." }],
    ]);
  });

  it("flattens Anthropic-style tool_use and tool_result blocks in arrays", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "do it" },
          { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "t1", name: "run" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] }
        ],
        tools: [{ name: "run", description: "d" }]
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge"
    });

    const panelCalls = handleSingleModel.mock.calls.filter(([,, isPanel]) => isPanel === true);
    expect(panelCalls.length).toBe(2);
    const panelBody = panelCalls[0][0];
    
    expect(panelBody.tools).toBeUndefined();
    expect(panelBody.messages.length).toBe(3);
    
    // Flattened tool_use
    expect(panelBody.messages[1].content).toBe("ok\n[Called tools: run]");
    
    // Flattened tool_result
    expect(panelBody.messages[2].content).toBe("[Tool result: done]");
  });

  it("waits for an aborted panel release before starting the judge", async () => {
    vi.useFakeTimers();
    try {
      let stragglerSignal;
      const events = [];
      const handleSingleModel = vi.fn(async (_body, model, isPanel, signal) => {
        if (model === "p/fast") return okResponse("fast answer");
        if (model === "p/slow" && isPanel) {
          stragglerSignal = signal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              events.push("abort:slow");
              setTimeout(() => {
                events.push("release:slow");
                reject(new DOMException("aborted", "AbortError"));
              }, 20);
            }, { once: true });
          });
        }
        events.push(`start:${model}`);
        return okResponse("judge answer");
      });
      const pending = handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: ["p/fast", "p/slow"],
        handleSingleModel,
        log,
        judgeModel: "p/judge",
        tuning: {
          minPanel: 1,
          stragglerGraceMs: 10,
          panelHardTimeoutMs: 1000,
          panelCancelDrainTimeoutMs: 100,
        },
      });
      await vi.advanceTimersByTimeAsync(11);
      expect(events).toEqual(["abort:slow"]);
      await vi.advanceTimersByTimeAsync(20);
      const response = await pending;
      expect(response.ok).toBe(true);
      expect(stragglerSignal.aborted).toBe(true);
      expect(events).toEqual(["abort:slow", "release:slow", "start:p/judge"]);
      expect(handleSingleModel).toHaveBeenCalledWith(expect.any(Object), "p/slow", true, expect.any(AbortSignal));
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails locally without a judge when canceled panel cleanup misses its deadline", async () => {
    vi.useFakeTimers();
    try {
      const handleSingleModel = vi.fn(async (_body, model, isPanel, signal) => {
        if (model === "p/fast") return okResponse("fast answer");
        if (model === "p/slow" && isPanel) {
          return new Promise(() => {
            signal.addEventListener("abort", () => {}, { once: true });
          });
        }
        return okResponse("judge must not run");
      });
      const pending = handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: ["p/fast", "p/slow"],
        handleSingleModel,
        log,
        judgeModel: "p/judge",
        tuning: {
          minPanel: 1,
          stragglerGraceMs: 10,
          panelHardTimeoutMs: 1000,
          panelCancelDrainTimeoutMs: 25,
        },
      });

      await vi.advanceTimersByTimeAsync(36);
      const response = await pending;

      expect(response.status).toBe(503);
      expect(handleSingleModel.mock.calls.some(([, model]) => model === "p/judge")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // Context-requirements eligibility must apply to fusion combos too —
  // the chat handler's fusion branch returns before handleComboChat, so without
  // the in-engine filter a configured min-context requirement was silently
  // ignored and every panel model got called.
  describe("context requirements", () => {
    // Registry-grounded fixtures (same as combo-context-requirements.test.js):
    const LARGE = "github-models/openai/gpt-4.1"; // contextLength 1047576
    const SMALL = "github-models/microsoft/Phi-4"; // contextLength 16384
    const UNKNOWN = "custom/no-catalog-entry"; // no registry context anywhere

    it("filters the panel BEFORE fan-out so an ineligible model is never called", async () => {
      const called = [];
      const handleSingleModel = vi.fn(async (_b, model) => {
        called.push(model);
        return okResponse(`answer from ${model}`);
      });
      const res = await handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: [SMALL, LARGE],
        handleSingleModel,
        log,
        comboName: "fusion-ctx",
        contextRequirements: { minContextWindow: 100000, contextFilterMode: "strict" },
      });
      expect(res.status).toBe(200);
      expect(called).not.toContain(SMALL);
      expect(called).toContain(LARGE);
    });

    it("returns 503 and calls nothing when every member fails the requirement", async () => {
      const handleSingleModel = vi.fn(async () => okResponse("should-not-run"));
      const res = await handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: [SMALL, UNKNOWN],
        handleSingleModel,
        log,
        comboName: "fusion-ctx-empty",
        contextRequirements: { minContextWindow: 100000, contextFilterMode: "strict" },
      });
      expect(res.status).toBe(503);
      expect(handleSingleModel).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.error.message).toMatch(/no models matching context requirements/i);
    });

    it("strict mode with minContextWindow 0 keeps known sizes but drops unknown-context models", async () => {
      const called = [];
      const handleSingleModel = vi.fn(async (_b, model) => {
        called.push(model);
        return okResponse(`answer from ${model}`);
      });
      const res = await handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: [SMALL, UNKNOWN],
        handleSingleModel,
        log,
        comboName: "fusion-ctx-zero",
        contextRequirements: { minContextWindow: 0, contextFilterMode: "strict" },
      });
      expect(res.status).toBe(200);
      expect(called).toContain(SMALL);
      expect(called).not.toContain(UNKNOWN);
    });

    it("returns 503 before fan-out when a member lacks a slash and context requirements are active", async () => {
      const handleSingleModel = vi.fn(async () => okResponse("should-not-run"));
      const res = await handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: ["bare-alias", LARGE],
        handleSingleModel,
        log,
        comboName: "fusion-invalid-member",
        contextRequirements: { minContextWindow: 100000, contextFilterMode: "strict" },
      });
      expect(res.status).toBe(503);
      expect(handleSingleModel).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.error.message).toMatch(/bare-alias/);
      expect(body.error.message).toMatch(/not a valid provider\/model member/i);
    });

    it("preferLargeContext orders the panel so the largest-context member leads (default judge)", async () => {
      const called = [];
      const handleSingleModel = vi.fn(async (_b, model) => {
        called.push(model);
        return okResponse(`answer from ${model}`);
      });
      // Panel given small-first; preference must reorder to large-first, and the
      // default judge falls back to panel[0] → the largest-context member.
      const res = await handleFusionChat({
        body: { messages: [{ role: "user", content: "Q" }] },
        models: [SMALL, LARGE],
        handleSingleModel,
        log,
        comboName: "fusion-ctx-prefer",
        contextRequirements: { preferLargeContext: true },
      });
      expect(res.status).toBe(200);
      expect(called[0]).toBe(LARGE);
      // Judge defaults to panel[0] and runs LAST → largest-context model synthesizes.
      expect(called.at(-1)).toBe(LARGE);
    });
  });
});
