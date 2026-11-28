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

import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import DeepSeekWebExecutor from "../../open-sse/executors/deepseek-web.js";
import deepseekWeb, { DEEPSEEK_WEB_COOKIE_PROFILE } from "../../open-sse/providers/registry/deepseek-web.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

const TOKEN_A = "synthetic-user-token-alpha";
const TOKEN_B = "synthetic-user-token-beta";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const completionEvent = (content) => `data: ${JSON.stringify({ data: { biz_data: { response: content } } })}\n\ndata: [DONE]\n\n`;

describe("DeepSeek Web registration and credential contract", () => {
  it("declares the pinned model catalog and web API transport", () => {
    expect(deepseekWeb).toMatchObject({ id: "deepseek-web", alias: "ds-web", category: "apikey", authType: "apikey" });
    expect(PROVIDERS["deepseek-web"]).toMatchObject({ baseUrl: "https://chat.deepseek.com/api/v0/chat/completion", executor: "deepseek-web", format: "openai" });
    expect(PROVIDER_MODELS["ds-web"].map(({ id }) => id)).toContain("deepseek-chat");
    expect(DEEPSEEK_WEB_COOKIE_PROFILE.cookieNames).toEqual([]);
  });

  it("validates and rejects userTokens through the upstream current-user probe", async () => {
    const valid = await probeRegistryProvider("deepseek-web", TOKEN_A, async () => json({ data: { biz_data: { token: "synthetic-access" } } }));
    const invalid = await probeRegistryProvider("deepseek-web", TOKEN_B, async () => json({ msg: "invalid" }, 401));
    expect(valid.valid).toBe(true);
    expect(invalid).toMatchObject({ valid: false, status: 401 });
  });

  it("discovers the static catalog through the shared provider model lookup", () => {
    expect(getProviderModels("deepseek-web").map(({ id }) => id)).toContain("deepseek-chat");
  });
});

describe("DeepSeek Web executor", () => {
  afterEach(() => vi.clearAllMocks());

  const setup = (finalResponse) => {
    upstreamFetch
      .mockResolvedValueOnce(json({ data: { biz_data: { token: "synthetic-access" } } }))
      .mockResolvedValueOnce(json({ data: { biz_data: { chat_session: { id: "synthetic-session" } } } }))
      .mockResolvedValueOnce(json({ data: { biz_data: { challenge: sourceChallenge } } }))
      .mockResolvedValueOnce(finalResponse);
  };

  it("uses a connection-specific token and returns non-streaming OpenAI content", async () => {
    setup(new Response(completionEvent("answer")));
    const executor = getExecutor("deepseek-web");
    expect(executor).toBeInstanceOf(DeepSeekWebExecutor);
    const output = await executor.execute({ model: "deepseek-chat", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: TOKEN_A }, stream: false });
    expect(output.response.status).toBe(200);
    assertSourceProof(upstreamFetch.mock.calls);
    expect((await output.response.json()).choices[0].message.content).toBe("answer");
    expect(upstreamFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(upstreamFetch.mock.calls[3][1].headers.Authorization).toBe("Bearer synthetic-access");
  });

  it("emits OpenAI SSE chunks and keeps two credentials isolated", async () => {
    setup(new Response(completionEvent("first")));
    setup(new Response(completionEvent("second")));
    const executor = getExecutor("deepseek-web");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const first = await executor.execute({ model: "deepseek-chat", body, credentials: { apiKey: TOKEN_A }, stream: true });
    const second = await executor.execute({ model: "deepseek-chat", body, credentials: { apiKey: TOKEN_B }, stream: false });
    assertSourceProof(upstreamFetch.mock.calls.slice(0, 4));
    assertSourceProof(upstreamFetch.mock.calls.slice(4));
    expect(await first.response.text()).toContain('"content":"first"');
    expect((await second.response.json()).choices[0].message.content).toBe("second");
    expect(upstreamFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(upstreamFetch.mock.calls[4][1].headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
  });

  it("maps expired auth and quota responses", async () => {
    setup(json({ msg: "expired" }, 403));
    const executor = getExecutor("deepseek-web");
    const expired = await executor.execute({ model: "deepseek-chat", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: TOKEN_A } });
    expect(expired.response.status).toBe(401);
    upstreamFetch.mockReset();
    setup(json({ msg: "rate limited" }, 429));
    const limited = await executor.execute({ model: "deepseek-chat", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: TOKEN_A } });
    expect(limited.response.status).toBe(429);
  });
});
