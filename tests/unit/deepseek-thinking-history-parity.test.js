/**
 * DeepSeek thinking-mode history on the OpenAI Chat route (#2034).
 *
 * First-party contract (api-docs.deepseek.com, Thinking Mode guide): when a
 * request carries `tools`, `reasoning_content` of prior assistant turns must be
 * passed back, otherwise the API answers 400. Clients that speak OpenAI Chat
 * drop that field, so the default executor echoes a placeholder for DeepSeek.
 * DeepSeek's Anthropic-compatible endpoint carries thinking as content blocks
 * and must never receive `reasoning_content`.
 *
 * Every case goes through DefaultExecutor.execute() with a closed fetch mock;
 * all values are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const CHAT_URL = "https://api.deepseek.com/chat/completions";
const MESSAGES_URL = "https://api.deepseek.com/anthropic/v1/messages";
const MODEL = "deepseek-v4-pro";
const PLACEHOLDER = " ";
const call = (id, name = "lookup") => ({ id, type: "function", function: { name, arguments: "{\"q\":\"synthetic\"}" } });

async function send(provider, messages, { transport, model = MODEL, extra = {} } = {}) {
  const body = { model, stream: false, messages, tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }], ...extra };
  await new DefaultExecutor(provider).execute({
    model, stream: false, body,
    credentials: { apiKey: "synthetic-key", ...(transport ? { runtimeTransport: transport } : {}) },
    requestPolicy: { maxTransportAttempts: 1 },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  return { url, headers: init.headers, body: JSON.parse(init.body) };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [] }))));
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek OpenAI Chat route: prior assistant turns", () => {
  const transport = { format: "openai", baseUrl: CHAT_URL };

  it("adds the placeholder to prior turns that carry no thinking history", async () => {
    const history = [
      { role: "system", content: "synthetic system" },
      { role: "user", content: "first" },
      { role: "assistant", content: null, tool_calls: [call("call_a")] },
      { role: "tool", tool_call_id: "call_a", content: "result" },
      { role: "assistant", content: "answer without tools" },
      { role: "user", content: "second" },
    ];
    const snapshot = structuredClone(history);
    const out = await send("deepseek", history, { transport });
    expect(out.url).toBe(CHAT_URL);
    expect(out.body.messages.map((m) => m.reasoning_content)).toEqual([undefined, undefined, PLACEHOLDER, undefined, PLACEHOLDER, undefined]);
    // The caller's history is not mutated by the repair.
    expect(history).toEqual(snapshot);
  });

  it("treats empty reasoning_content as absent", async () => {
    const out = await send("deepseek", [
      { role: "user", content: "q" },
      { role: "assistant", content: "a", reasoning_content: "" },
    ], { transport });
    expect(out.body.messages[1].reasoning_content).toBe(PLACEHOLDER);
  });

  it("keeps reasoning_content that the client already supplied", async () => {
    const out = await send("deepseek", [
      { role: "user", content: "q1" },
      { role: "assistant", content: "", reasoning_content: "synthetic thought one", tool_calls: [call("call_a")] },
      { role: "tool", tool_call_id: "call_a", content: "result" },
      { role: "assistant", content: "bare turn" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "kept", reasoning_content: "synthetic thought two" },
    ], { transport });
    expect(out.body.messages.map((m) => m.reasoning_content)).toEqual([
      undefined, "synthetic thought one", undefined, PLACEHOLDER, undefined, "synthetic thought two",
    ]);
  });

  it("replays tool turns without altering ids, arguments or ordering", async () => {
    const calls = [call("call_a", "lookup"), call("call_b", "other")];
    const out = await send("deepseek", [
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: calls },
      { role: "tool", tool_call_id: "call_a", content: "one" },
      { role: "tool", tool_call_id: "call_b", content: "two" },
      { role: "user", content: "next" },
    ], { transport });
    const [, assistant, toolA, toolB] = out.body.messages;
    expect(assistant).toMatchObject({ role: "assistant", content: null, reasoning_content: PLACEHOLDER });
    expect(assistant.tool_calls).toEqual(calls);
    expect([toolA, toolB]).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "one" },
      { role: "tool", tool_call_id: "call_b", content: "two" },
    ]);
    expect(out.body.tools).toHaveLength(1);
  });

  it("leaves a request without assistant turns unchanged", async () => {
    const messages = [{ role: "user", content: "only user" }];
    const out = await send("deepseek", messages, { transport });
    expect(out.body.messages).toEqual(messages);
  });
});

describe("DeepSeek Anthropic alternative", () => {
  const blocks = [
    { role: "user", content: [{ type: "text", text: "q" }] },
    { role: "assistant", content: [
      { type: "thinking", thinking: "synthetic thought", signature: "synthetic-signature" },
      { type: "tool_use", id: "toolu_a", name: "lookup", input: { q: "synthetic" } },
    ] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "result" }] },
    { role: "assistant", content: [{ type: "text", text: "plain answer" }] },
  ];

  it.each(["claude", "claude-apikey"])("sends no reasoning_content on a %s transport", async (format) => {
    const out = await send("deepseek", structuredClone(blocks), { transport: { format, baseUrl: MESSAGES_URL } });
    expect(out.url).toBe(MESSAGES_URL);
    expect(JSON.stringify(out.body)).not.toContain("reasoning_content");
    // Thinking blocks and their signatures travel through untouched.
    expect(out.body.messages[1].content[0]).toEqual(blocks[1].content[0]);
    expect(out.body.messages[1].content[1]).toEqual(blocks[1].content[1]);
    expect(out.body.messages[3]).toEqual(blocks[3]);
  });
});

describe("second provider serving the same model ID", () => {
  it("does not apply the DeepSeek echo to the Anthropic wire of another provider", async () => {
    const out = await send("openrouter", structuredClone([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]), { transport: { format: "claude", baseUrl: "https://synthetic.invalid/v1/messages" } });
    expect(out.url).not.toContain("deepseek.com");
    expect(JSON.stringify(out.body)).not.toContain("reasoning_content");
  });

  it("keeps its own endpoint and credentials and preserves supplied reasoning", async () => {
    const out = await send("openrouter", [
      { role: "user", content: "q" },
      { role: "assistant", content: "a", reasoning_content: "synthetic thought" },
    ]);
    expect(out.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(out.url).not.toBe(CHAT_URL);
    expect(out.body.messages[1].reasoning_content).toBe("synthetic thought");
  });

  it("leaves a non-DeepSeek model on the same provider untouched", async () => {
    const out = await send("openrouter", [
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ], { model: "synthetic-vendor/plain-model" });
    expect(out.body.messages[1]).toEqual({ role: "assistant", content: "a" });
  });
});
