import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

// Regression for #5273: Grok Build returns `400 'Model does not support parameter
// presencePenalty'` when clients (MiMoCode, Cursor, …) send OpenAI-style sampling
// params Grok Build cannot accept. transformRequest() must strip them before forwarding.
// dev's grok-cli executor speaks the Responses API: it converts `messages` into
// `input`, always streams upstream, and drops any key outside its allowlist.
const UNSUPPORTED = ["presencePenalty", "frequencyPenalty", "logprobs", "topLogprobs"];

describe("grok-cli transformRequest", () => {
  it("#5273 strips unsupported sampling params", () => {
    const executor = new GrokCliExecutor();
    const body = {
      model: "grok-build",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      top_p: 0.9,
      presencePenalty: 0.5,
      frequencyPenalty: 0.3,
      logprobs: true,
      topLogprobs: 5,
    };

    const out = executor.transformRequest("grok-build", body, false, {});

    // Unsupported params are gone…
    for (const param of UNSUPPORTED) {
      expect(param in out).toBe(false);
    }
    // …while supported sampling params survive and messages become Responses input.
    expect(out.temperature).toBe(0.7);
    expect(out.top_p).toBe(0.9);
    expect(out.input).toEqual([{ type: "message", role: "user", content: "hi" }]);
    expect(out.model).toBe("grok-build");
    // The Responses-style executor always forces streaming upstream.
    expect(out.stream).toBe(true);
  });

  it("#5273 leaves a clean body's sampling params unchanged (no false stripping)", () => {
    const executor = new GrokCliExecutor();
    const out = executor.transformRequest(
      "grok-composer-2.5-fast",
      { messages: [{ role: "user", content: "ok" }], temperature: 1 },
      true,
      {},
    );

    expect(out.temperature).toBe(1);
    expect(out.input).toEqual([{ type: "message", role: "user", content: "ok" }]);
    expect(out.stream).toBe(true);
  });

  // Ported from decolua/9router#2534 (@gitcommit90): xAI's cli-chat-proxy enforces a
  // hard cap of 200 tools per request and 400s above it. Clients that fan a large MCP
  // toolset through Grok Build/Composer can exceed that ceiling — transformRequest()
  // must cap defensively instead of forwarding an oversized array upstream.
  it("2534 caps tools at 200 and preserves the first 200 in order", () => {
    const executor = new GrokCliExecutor();
    const tools = Array.from({ length: 250 }, (_, i) => ({
      type: "function",
      function: { name: `tool_${i}` },
    }));
    const out = executor.transformRequest(
      "grok-build",
      { messages: [{ role: "user", content: "hi" }], tools },
      false,
      {},
    );

    expect(out.tools.length).toBe(200);
    expect(out.tools).toEqual(tools.slice(0, 200));
  });

  it("2534 leaves a tools array under the cap untouched", () => {
    const executor = new GrokCliExecutor();
    const tools = Array.from({ length: 10 }, (_, i) => ({
      type: "function",
      function: { name: `tool_${i}` },
    }));
    const out = executor.transformRequest(
      "grok-composer-2.5-fast",
      { messages: [{ role: "user", content: "hi" }], tools },
      false,
      {},
    );

    expect(out.tools).toEqual(tools);
  });
});
