import { deepSeekHashV1 } from "../../open-sse/executors/deepseek-web/deepseek-pow-hash.js";
const sourceChallenge = { algorithm: "DeepSeekHashV1", salt: "fixture-2034", expire_at: 1900000000,
  difficulty: 8, signature: "synthetic-signature", challenge: deepSeekHashV1("fixture-2034_1900000000_3") };
const assertSourceProof = (calls) => {
  expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
    "/api/v0/users/current", "/api/v0/chat_session/create", "/api/v0/chat/create_pow_challenge", "/api/v0/chat/completion",
  ]);
  expect(JSON.parse(calls[2][1].body)).toEqual({ target_path: "/api/v0/chat/completion" });
  expect(JSON.parse(Buffer.from(calls[3][1].headers["X-Ds-Pow-Response"], "base64"))).toEqual({
    algorithm: sourceChallenge.algorithm, challenge: sourceChallenge.challenge, salt: sourceChallenge.salt,
    answer: 3, signature: sourceChallenge.signature, target_path: "/api/v0/chat/completion",
  });
};
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
const completionEvent = (content) => `data: ${JSON.stringify({ data: { biz_data: { response: content } } })}\n\ndata: [DONE]\n\n`;

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
        .mockResolvedValueOnce(json({ data: { biz_data: { challenge: sourceChallenge } } }))
        .mockResolvedValueOnce(new Response(completionEvent("ok")));

      const output = await executor.execute({
        model,
        body: { messages: [{ role: "user", content: "hello" }] },
        credentials: { apiKey: "synthetic-user-token" },
        stream: false,
      });

      expect(output.response.status).toBe(200);
      assertSourceProof(upstreamFetch.mock.calls.slice(-4));
      const sent = JSON.parse(upstreamFetch.mock.calls.at(-1)[1].body);
      expect(sent.model_type).toBe(expectedType);
      expect(sent.thinking_enabled).toBe(expectedThinking);
    }
  });
});
