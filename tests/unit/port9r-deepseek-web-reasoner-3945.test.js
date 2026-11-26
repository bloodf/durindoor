import { afterEach, describe, expect, it, vi } from "vitest";

const upstreamFetch = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.stubGlobal("fetch", upstreamFetch);

import DeepSeekWebExecutor, { resolveDeepSeekWebModelOptions } from "../../open-sse/executors/deepseek-web.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
});
const completionEvent = (content) => `data: ${JSON.stringify({ data: { biz_data: { response: content } } })}\n\n`;

describe("9router #3945 DeepSeek Web reasoner and R1 expert mode routing", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["deepseek-chat", "default", false, false],
    ["deepseek-v4-flash", "default", false, false],
    ["deepseek-v4.1-flash", "default", false, false],
    ["deepseek-v4-pro", "expert", false, false],
    ["deepseek-v4.1-pro", "expert", false, false],
    ["deepseek-reasoner", "expert", true, false],
    ["deepseek-v4.1-reasoner", "expert", true, false],
    ["DeepSeek-R1", "expert", true, false],
    ["DeepSeek-R1-Search", "expert", true, true],
  ])("maps %s to modelType=%s thinkingEnabled=%s searchEnabled=%s", (model, modelType, thinkingEnabled, searchEnabled) => {
    expect(resolveDeepSeekWebModelOptions(model, {})).toEqual({
      modelType,
      thinkingEnabled,
      searchEnabled,
    });
  });

  it("sends model_type=expert and thinking_enabled=true for reasoner and R1 completions", async () => {
    const executor = new DeepSeekWebExecutor();
    for (const [model, expectedType, expectedThinking] of [
      ["deepseek-reasoner", "expert", true],
      ["DeepSeek-R1", "expert", true],
      ["deepseek-v4-flash", "default", false],
    ]) {
      upstreamFetch
        .mockResolvedValueOnce(json({ data: { biz_data: { token: "synthetic-access" } } }))
        .mockResolvedValueOnce(json({ data: { biz_data: { chat_session: { id: "synthetic-session" } } } }))
        .mockResolvedValueOnce(new Response(completionEvent("ok")));

      const output = await executor.execute({
        model,
        body: { messages: [{ role: "user", content: "hello" }] },
        credentials: { apiKey: "synthetic-user-token" },
        stream: false,
      });

      expect(output.response.status).toBe(200);
      const sent = JSON.parse(upstreamFetch.mock.calls.at(-1)[1].body);
      expect(sent.model_type).toBe(expectedType);
      expect(sent.thinking_enabled).toBe(expectedThinking);
    }
  });
});
