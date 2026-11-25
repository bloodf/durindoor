import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest
} from "../../open-sse/translator/request/openai-responses.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";
import {
  capOpenAICacheBreakpoints,
  isOpenRouterAnthropicModel
} from "../../open-sse/translator/concerns/openrouterAnthropicCache.js";

// ── #20243 unpaired tool output ───────────────────────────────────────────────────────────
const user = { role: "user", content: "hi" };
const call = (id) => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name: "lookup", arguments: "{}" } }]
});
const toResponses = (messages) =>
  openaiToOpenAIResponsesRequest("gpt-5", { model: "gpt-5", messages, stream: false }, false, null).input;
const toChat = (input) =>
  openaiResponsesToOpenAIRequest("gpt-5", { model: "gpt-5", input, stream: false }, false, null).messages;
const userItem = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };

describe("#20243 Chat -> Responses unpaired tool output", () => {
  it("drops a role:tool output with no tool_call_id and no call to pair", () => {
    const input = toResponses([user, { role: "tool", content: "orphan output text" }]);
    expect(input.filter((item) => item.type === "function_call_output")).toEqual([]);
  });

  it("drops a blank tool_call_id next to a valid pair and keeps the pair", () => {
    const input = toResponses([
      user,
      call("call_1"),
      { role: "tool", tool_call_id: "call_1", content: "paired" },
      { role: "tool", tool_call_id: "   ", content: "orphan output text" }
    ]);
    const outputs = input.filter((item) => item.type === "function_call_output");
    expect(outputs.map((item) => [item.call_id, item.output])).toEqual([["call_1", "paired"]]);
  });

  it("never sends an output with a made-up id after a real call that lacks its own result id", () => {
    const input = toResponses([user, call("call_1"), { role: "tool", content: "no id" }]);
    const calls = input.filter((item) => item.type === "function_call").map((item) => item.call_id);
    const outputs = input.filter((item) => item.type === "function_call_output");
    expect(calls).toEqual(["call_1"]);
    expect(outputs.every((item) => calls.includes(item.call_id))).toBe(true);
    expect(outputs.some((item) => item.output === "no id")).toBe(false);
  });

  it("still pairs a valid tool message", () => {
    const input = toResponses([user, call("call_1"), { role: "tool", tool_call_id: "call_1", content: "ok" }]);
    expect(input.map((item) => item.type)).toEqual(["message", "function_call", "function_call_output"]);
    expect(input[2]).toMatchObject({ call_id: "call_1", output: "ok" });
  });
});

describe("#20243 Responses -> Chat blank-id custom calls", () => {
  it("skips a custom_tool_call with a blank call_id together with its output", () => {
    const messages = toChat([
      userItem,
      { type: "custom_tool_call", call_id: "", name: "apply_patch", input: "x" },
      { type: "custom_tool_call_output", call_id: "", output: "patched text" }
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("skips a custom_tool_call with a missing call_id", () => {
    const messages = toChat([
      userItem,
      { type: "custom_tool_call", name: "apply_patch", input: "x" },
      { type: "custom_tool_call_output", output: "patched text" }
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("keeps a custom_tool_call that has a call_id", () => {
    const messages = toChat([
      userItem,
      { type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: "x" },
      { type: "custom_tool_call_output", call_id: "call_patch", output: "patched text" }
    ]);
    expect(messages.map((m) => [m.role, m.tool_call_id ?? null, m.content === "patched text"])).toEqual([
      ["user", null, false],
      ["assistant", null, false],
      ["tool", "call_patch", true]
    ]);
  });

  it("drops the blank-id pair but keeps a valid pair beside it", () => {
    const messages = toChat([
      userItem,
      { type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: "x" },
      { type: "custom_tool_call", call_id: "", name: "apply_patch", input: "y" },
      { type: "custom_tool_call_output", call_id: "", output: "blank output" },
      { type: "custom_tool_call_output", call_id: "call_patch", output: "patched text" }
    ]);
    const tools = messages.filter((m) => m.role === "tool");
    expect(tools.map((m) => [m.tool_call_id, m.content])).toEqual([["call_patch", "patched text"]]);
  });

  it("keeps one placeholder message when the blank-id pair was the whole input", () => {
    const messages = toChat([
      { type: "custom_tool_call", call_id: "", name: "apply_patch", input: "x" },
      { type: "custom_tool_call_output", call_id: "", output: "patched text" }
    ]);
    expect(messages).toEqual([{ role: "user", content: "..." }]);
  });

  it("keeps the native id-less function_call_output repair path", () => {
    const messages = toChat([
      userItem,
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", output: "paired by order" }
    ]);
    expect(messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m.content])).toEqual([
      ["call_1", "paired by order"]
    ]);
  });
});

// ── #19755 OpenRouter anthropic/* cache markers ───────────────────────────────────────────
const EPHEMERAL = { type: "ephemeral" };
const ANTHROPIC = "anthropic/claude-sonnet-4.5";
const countMarkers = (value) => JSON.stringify(value).split('"cache_control"').length - 1;
const part = (text, cache_control) => ({ type: "text", text, ...(cache_control ? { cache_control } : {}) });
const chatBody = (model) => ({
  model,
  messages: [
    { role: "system", content: [part("s1", EPHEMERAL), part("s2", EPHEMERAL)] },
    { role: "user", content: [part("u1", EPHEMERAL)] },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: [part("file body", EPHEMERAL)] },
    { role: "user", content: [part("u2", EPHEMERAL)] },
    { role: "assistant", content: [part("a1", EPHEMERAL)] },
    { role: "user", content: [part("u3", EPHEMERAL)] }
  ]
});
const send = (body, provider, model = body.model) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, model, structuredClone(body), false, null, provider);

describe("#19755 openrouter anthropic/* cache breakpoints", () => {
  it("recognizes only openrouter + anthropic/* models", () => {
    expect(isOpenRouterAnthropicModel("openrouter", ANTHROPIC)).toBe(true);
    expect(isOpenRouterAnthropicModel("openrouter", "Anthropic/claude-3")).toBe(true);
    expect(isOpenRouterAnthropicModel("openrouter", "openai/gpt-5")).toBe(false);
    expect(isOpenRouterAnthropicModel("openai", ANTHROPIC)).toBe(false);
    expect(isOpenRouterAnthropicModel("openrouter", null)).toBe(false);
  });

  it("keeps at most four markers, protects the system prefix, and drops tool-message markers", () => {
    const out = send(chatBody(ANTHROPIC), "openrouter");
    expect(countMarkers(out)).toBe(4);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(countMarkers(tool)).toBe(0);
    const system = out.messages.find((m) => m.role === "system");
    // The prefix anchor (last system marker) survives; the earlier system marker does not.
    expect(system.content[0].cache_control).toBeUndefined();
    expect(system.content[1].cache_control).toEqual(EPHEMERAL);
    // The newest markers fill the remaining slots.
    const last = out.messages.at(-1);
    expect(last.content[0].cache_control).toEqual(EPHEMERAL);
  });

  it("leaves a request at or under four markers untouched", () => {
    const body = {
      model: ANTHROPIC,
      messages: [
        { role: "system", content: [part("s", EPHEMERAL)] },
        { role: "user", content: [part("u", { type: "ephemeral", ttl: "1h" })] }
      ]
    };
    const out = send(body, "openrouter");
    expect(out.messages[0].content[0].cache_control).toEqual(EPHEMERAL);
    expect(out.messages[1].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("drops invalid markers and does not count them against the limit", () => {
    const out = capOpenAICacheBreakpoints({
      messages: [
        { role: "user", content: [part("a", { type: "weird" }), part("b", { type: "ephemeral", ttl: "9d" }), part("c", null)] },
        { role: "user", content: [part("d", EPHEMERAL)] }
      ]
    });
    expect(countMarkers(out)).toBe(1);
    expect(out.messages[1].content[0].cache_control).toEqual(EPHEMERAL);
  });

  it("does not mutate the caller's body", () => {
    const body = chatBody(ANTHROPIC);
    const snapshot = JSON.stringify(body);
    capOpenAICacheBreakpoints(body);
    expect(JSON.stringify(body)).toBe(snapshot);
  });

  // filterToOpenAIFormat has always passed role:"tool" messages through as-is, so a marker on one
  // is the only thing a non-preserving route leaves; every other message is stripped.
  const outsideToolMessages = (out) => countMarkers(out.messages.filter((m) => m.role !== "tool"));

  it("strips every non-tool marker for other OpenRouter model families", () => {
    for (const model of ["openai/gpt-5", "google/gemini-2.5-pro", "qwen/qwen3-max"]) {
      const out = send(chatBody(model), "openrouter");
      expect(outsideToolMessages(out)).toBe(0);
      expect(countMarkers(out)).toBe(1);
    }
  });

  it("leaves other providers byte-identical, including an anthropic/* id", () => {
    const baseline = send(chatBody("gpt-5"), "openai");
    expect(outsideToolMessages(baseline)).toBe(0);
    for (const provider of ["openai", null]) {
      const out = send(chatBody(ANTHROPIC), provider);
      expect(out.messages).toEqual(baseline.messages);
    }
  });

  it("keeps a lone marked text part from a Claude request instead of collapsing it", () => {
    const body = {
      model: ANTHROPIC,
      system: [{ type: "text", text: "sys", cache_control: EPHEMERAL }],
      messages: [{ role: "user", content: [{ type: "text", text: "question", cache_control: EPHEMERAL }] }]
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, ANTHROPIC, structuredClone(body), false, null, "openrouter");
    expect(out.messages.at(-1).content).toEqual([part("question", EPHEMERAL)]);
    expect(countMarkers(out)).toBe(2);
    const stripped = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "openai/gpt-5", structuredClone(body), false, null, "openrouter");
    expect(countMarkers(stripped)).toBe(0);
  });
});

describe("#19755 cache-aware compression protects the cached prefix", () => {
  const body = () => ({
    messages: [
      { role: "system", content: [part("stable system prompt", EPHEMERAL)] },
      { role: "user", content: [part("older turn", EPHEMERAL)] },
      { role: "user", content: [part("fresh turn that may be compressed")] }
    ]
  });
  const engineThat = (rewrite) => ({
    apply: async (input) => ({ body: rewrite(structuredClone(input)), compressed: true })
  });
  const deps = (engine) => ({
    isEngineAvailable: () => true,
    getEngine: () => engine,
    deriveDefaultPlan: () => ({ mode: "stacked", stackedPipeline: [{ engine: "fake" }] }),
    resolveAdaptivePlan: ({ basePlan }) => ({ plan: basePlan }),
    planToEngineIds: () => ["fake"]
  });
  const run = (engine, protectCachedPrefix) =>
    runCompressionSeam(body(), deps(engine), { enabled: true, engines: {}, protectCachedPrefix });

  const rewritePrefix = engineThat((b) => {
    b.messages[1].content[0].text = "older";
    return b;
  });
  const rewriteTail = engineThat((b) => {
    b.messages[2].content[0].text = "fresh";
    return b;
  });

  it("rolls back a step that rewrites text inside the cached prefix", async () => {
    const out = await run(rewritePrefix, true);
    expect(out.headerValue).toBeNull();
    expect(out.body.messages[1].content[0].text).toBe("older turn");
  });

  it("still compresses content after the last cache marker", async () => {
    const out = await run(rewriteTail, true);
    expect(out.headerValue).toMatch(/^fake\|/);
    expect(out.body.messages[2].content[0].text).toBe("fresh");
  });

  it("does not guard anything when the flag is off", async () => {
    const out = await run(rewritePrefix, false);
    expect(out.headerValue).toMatch(/^fake\|/);
    expect(out.body.messages[1].content[0].text).toBe("older");
  });

  it("does not guard a body that carries no cache marker", async () => {
    const plain = { messages: [{ role: "user", content: [part("a long unmarked turn")] }] };
    const engine = engineThat((b) => {
      b.messages[0].content[0].text = "short";
      return b;
    });
    const out = await runCompressionSeam(plain, deps(engine), { enabled: true, engines: {}, protectCachedPrefix: true });
    expect(out.body.messages[0].content[0].text).toBe("short");
  });
});
