/**
 * #2332 ClinePass envelope unwrap + thinking-budget floor.
 *
 * Covers:
 *  - unwrapClinepassEnvelope pass-through + {success,data} + {success:false,error}
 *  - parseUpstreamError surfaces inner envelope message
 *  - DefaultExecutor.ensureThinkingBudget respects caps.maxOutput, bumps only when
 *    reasoning enabled, preserves caller's token field (max_tokens vs max_completion_tokens)
 *  - handleNonStreamingResponse does NOT call onRequestSuccess for a failure envelope
 */
import { describe, it, expect, vi } from "vitest";

import { unwrapClinepassEnvelope } from "../../open-sse/utils/clinepassEnvelope.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { DefaultExecutor, computeThinkingBudget, THINKING_BUDGET_FLOOR } from "../../open-sse/executors/default.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

describe("unwrapClinepassEnvelope", () => {
  it("passes through non-clinepass providers", () => {
    const input = { success: true, data: { id: "x" } };
    expect(unwrapClinepassEnvelope(input, "openai").body).toBe(input);
  });

  it("passes through bodies without a boolean success flag", () => {
    const input = { id: "chatcmpl-1", choices: [] };
    expect(unwrapClinepassEnvelope(input, "clinepass").body).toBe(input);
    expect(unwrapClinepassEnvelope({ success: "yes" }, "clinepass").body).toEqual({ success: "yes" });
  });

  it("unwraps {success:true,data:<object>} to data", () => {
    const inner = { id: "chatcmpl-1", choices: [] };
    const { body, error } = unwrapClinepassEnvelope({ success: true, data: inner }, "clinepass");
    expect(error).toBeNull();
    expect(body).toBe(inner);
  });

  it("does NOT unwrap null/primitive data", () => {
    const a = { success: true, data: null };
    expect(unwrapClinepassEnvelope(a, "clinepass").body).toBe(a);
    const b = { success: true, data: "raw" };
    expect(unwrapClinepassEnvelope(b, "clinepass").body).toBe(b);
  });

  it("surfaces inner error message (string)", () => {
    const { error } = unwrapClinepassEnvelope({ success: false, error: "empty response content" }, "clinepass");
    expect(error?.message).toBe("empty response content");
  });

  it("surfaces inner error message (object) and fallbacks", () => {
    expect(unwrapClinepassEnvelope({ success: false, error: { message: "boom" } }, "clinepass").error?.message).toBe("boom");
    expect(unwrapClinepassEnvelope({ success: false, error: { code: "E_NO" } }, "clinepass").error?.message).toBe("E_NO");
    expect(unwrapClinepassEnvelope({ success: false, message: "top-level" }, "clinepass").error?.message).toBe("top-level");
    expect(unwrapClinepassEnvelope({ success: false }, "clinepass").error?.message).toBe("ClinePass request failed");
  });
});

describe("parseUpstreamError ClinePass envelope", () => {
  it("returns inner message from {success:false,error}", async () => {
    const response = { status: 400, text: async () => JSON.stringify({ success: false, error: "empty response content" }) };
    const result = await parseUpstreamError(response, { provider: "clinepass" });
    expect(result.message).toBe("empty response content");
    expect(result.statusCode).toBe(400);
  });

  it("honors executor.getProvider() public API", async () => {
    const response = { status: 502, text: async () => JSON.stringify({ success: false, error: { message: "nope" } }) };
    const result = await parseUpstreamError(response, { getProvider: () => "clinepass" });
    expect(result.message).toBe("nope");
  });
});

describe("DefaultExecutor.ensureThinkingBudget (clinepass)", () => {
  const ex = new DefaultExecutor("clinepass");

  it("no-ops for non-clinepass providers", () => {
    const other = new DefaultExecutor("openai");
    const body = { reasoning_effort: "high", max_tokens: 100 };
    expect(other.ensureThinkingBudget(body, "gpt-4o").max_tokens).toBe(100);
  });

  it("leaves body untouched when reasoning disabled", () => {
    const body = { reasoning_effort: "none", max_tokens: 128, messages: [] };
    expect(ex.ensureThinkingBudget(body, "cline-pass/deepseek-v4-pro").max_tokens).toBe(128);
  });

  it("bumps small max_tokens up to floor when reasoning enabled", () => {
    const body = { reasoning_effort: "medium", max_tokens: 512, messages: [] };
    expect(ex.ensureThinkingBudget(body, "cline-pass/deepseek-v4-pro").max_tokens).toBe(4096);
  });

  it("preserves max_completion_tokens field (does not introduce max_tokens)", () => {
    const body = { reasoning_effort: "high", max_completion_tokens: 256, messages: [] };
    const out = ex.ensureThinkingBudget(body, "cline-pass/deepseek-v4-pro");
    expect(out.max_completion_tokens).toBe(4096);
    expect(out.max_tokens).toBeUndefined();
  });

  it("fills a missing budget to floor using the model's high cap", () => {
    // cline-pass/deepseek-v4-pro caps.maxOutput = 50000 → floor applies.
    const body = { reasoning_effort: "medium", messages: [] };
    expect(ex.ensureThinkingBudget(body, "cline-pass/deepseek-v4-pro").max_tokens).toBe(4096);
  });

  it("bumps an undersized existing budget when the model cap allows the floor", () => {
    const body = { reasoning_effort: "high", max_tokens: 512, messages: [] };
    expect(ex.ensureThinkingBudget(body, "cline-pass/deepseek-v4-pro").max_tokens).toBe(4096);
  });

  it("leaves a low-cap model's positive budget untouched (never lowers/exceeds cap)", async () => {
    // Mock a clinepass reasoning entry whose maxOutput is below the floor;
    // ensureThinkingBudget must read that cap and refuse to bump past it.
    const caps = await import("../../open-sse/providers/capabilities.js");
    const prev = caps.PROVIDER_CAPABILITIES.clinepass?.["cline-pass/tiny"];
    caps.PROVIDER_CAPABILITIES.clinepass = {
      ...(caps.PROVIDER_CAPABILITIES.clinepass || {}),
      "cline-pass/tiny": { reasoning: true, thinkingFormat: "openai", maxOutput: 2048 },
    };
    try {
      const missing = { reasoning_effort: "high", messages: [] };
      expect(ex.ensureThinkingBudget(missing, "cline-pass/tiny").max_tokens).toBe(2048);
      const positive = { reasoning_effort: "high", max_tokens: 512, messages: [] };
      expect(ex.ensureThinkingBudget(positive, "cline-pass/tiny").max_tokens).toBe(512);
    } finally {
      if (prev === undefined) delete caps.PROVIDER_CAPABILITIES.clinepass["cline-pass/tiny"];
      else caps.PROVIDER_CAPABILITIES.clinepass["cline-pass/tiny"] = prev;
    }
  });
});

describe("computeThinkingBudget (pure)", () => {
  it("exports floor = 4096", () => {
    expect(THINKING_BUDGET_FLOOR).toBe(4096);
  });
  it("fills missing/invalid current with min(floor, cap)", () => {
    expect(computeThinkingBudget(undefined, 50000)).toBe(4096);
    expect(computeThinkingBudget(0, 50000)).toBe(4096);
    expect(computeThinkingBudget(-5, 50000)).toBe(4096);
    expect(computeThinkingBudget(undefined, 2048)).toBe(2048);
  });
  it("bumps undersized current to floor when cap can reach it", () => {
    expect(computeThinkingBudget(128, 50000)).toBe(4096);
    expect(computeThinkingBudget(3000, 50000)).toBe(4096);
  });
  it("never lowers or exceeds a positive budget under a low cap", () => {
    // cap below floor: a positive budget is left untouched, never lowered or
    // bumped past the cap.
    expect(computeThinkingBudget(128, 2048)).toBeNull();
    expect(computeThinkingBudget(500, 1000)).toBeNull();
    expect(computeThinkingBudget(3000, 2048)).toBeNull();
  });
  it("returns null when current already >= floor", () => {
    expect(computeThinkingBudget(4096, 50000)).toBeNull();
    expect(computeThinkingBudget(8192, 50000)).toBeNull();
    expect(computeThinkingBudget(5000, 4096)).toBeNull();
  });
});

describe("handleNonStreamingResponse clinepass failure envelope", () => {
  it("returns 502 and does NOT invoke onRequestSuccess", async () => {
    const onRequestSuccess = vi.fn();
    const appendLog = vi.fn();
    const providerResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ success: false, error: "empty response content" }),
    };
    const reqLogger = { logProviderResponse: vi.fn() };

    const result = await handleNonStreamingResponse({
      providerResponse,
      provider: "clinepass",
      model: "cline-pass/deepseek-v4-pro",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: {},
      stream: false,
      streamToClient: false,
      translatedBody: {},
      finalBody: {},
      requestStartTime: Date.now(),
      connectionId: "c1",
      apiKey: "k",
      clientRawRequest: {},
      onRequestSuccess,
      reqLogger,
      toolNameMap: {},
      trackDone: () => {},
      appendLog,
      pxpipe: null,
      reqTag: "t",
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe("empty response content");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
