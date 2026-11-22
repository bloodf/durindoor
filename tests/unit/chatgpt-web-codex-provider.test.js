import "../translator/registerAll.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import codexProvider, { cookieCaptureProfile } from "../../open-sse/providers/private/chatgpt-web-codex.js";
import { ChatGptWebCodexExecutor } from "../../open-sse/executors/chatgpt-web-codex.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const fakeHttp = vi.hoisted(() => ({ execute: vi.fn() }));
const cookieA = "__Secure-next-auth.session-token=fixture-cookie-alpha";
const cookieB = "__Secure-next-auth.session-token=fixture-cookie-beta";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };

vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { default: provider } = await import("../../open-sse/providers/private/chatgpt-web-codex.js");
  return { ...original, default: [...original.default, provider] };
});
vi.mock("../../open-sse/providers/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { default: provider } = await import("../../open-sse/providers/private/chatgpt-web-codex.js");
  const transport = { ...provider.transport, authType: provider.authType };
  const models = provider.models.map((model) => ({ ...model, provider: provider.id }));
  return {
    ...original,
    PROVIDERS: { ...original.PROVIDERS, [provider.id]: transport },
    PROVIDER_MODELS: { ...original.PROVIDER_MODELS, [provider.id]: models, [provider.alias]: models },
    PROVIDER_MEDIA: { ...original.PROVIDER_MEDIA, [provider.id]: { serviceKinds: ["llm"] } },
  };
});
vi.mock("@/shared/constants/providers", async (importOriginal) => {
  const original = await importOriginal();
  const metadata = { id: "chatgpt-web-codex", alias: "cgpt-codex", authType: "cookie", defaultBaseUrl: "https://chatgpt.com/backend-api/f/conversation", serviceKinds: ["llm"] };
  return { ...original, AI_PROVIDERS: { ...original.AI_PROVIDERS, "chatgpt-web-codex": metadata } };
});
vi.mock("../../src/app/api/providers/[id]/models/modelsConfig.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, PROVIDER_MODELS_CONFIG: { ...original.PROVIDER_MODELS_CONFIG, "chatgpt-web-codex": { customResolver: async () => ({ models: codexProvider.models }) } } };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const json = (body, status = 200) => Response.json(body, { status });
const result = (body, status = 200) => ({ response: json(body, status), url: "https://chatgpt.com/backend-api/f/conversation", headers: {}, transformedBody: body });

beforeEach(() => {
  vi.clearAllMocks();
  getExecutor("chatgpt-web-codex").httpExecutor = fakeHttp;
  fakeHttp.execute.mockImplementation(async (input) => {
    const { stream, model, body, credentials } = input;
    if (credentials.apiKey === "expired") return result({ error: { message: "Invalid session cookie" } }, 401);
    if (credentials.apiKey === "quota") return result({ error: { message: "quota exceeded" } }, 429);
    if (stream) {
      return { response: new Response(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }), url: "https://chatgpt.com/backend-api/f/conversation", headers: {}, transformedBody: body };
    }
    return result({ id: "fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  vi.stubGlobal("fetch", vi.fn(async () => json({ accessToken: "synthetic-access-token", user: { id: "fixture-user" } })));
});
afterEach(() => vi.unstubAllGlobals());

async function chat(body, format = "openai", cookie = cookieA) {
  return handleChatCore({
    body,
    modelInfo: { provider: "chatgpt-web-codex", model: body.model.split("/").at(-1) },
    credentials: { apiKey: cookie, authType: "cookie", connectionId: "fixture-connection", providerSpecificData: { transport: "http" } },
    sourceFormatOverride: format,
    clientRawRequest: { endpoint: format === "claude" ? "/v1/messages" : "/v1/chat/completions", body, headers: {} },
    connectionId: "fixture-connection", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
}

describe("ChatGPT Web Codex provider", () => {
  it("registers the Codex lane executor in the real executor table", () => {
    expect(getExecutor("chatgpt-web-codex")).toBeInstanceOf(ChatGptWebCodexExecutor);
    expect(getExecutor("cgpt-codex")).toBeInstanceOf(ChatGptWebCodexExecutor);
  });
  it("exports the cookie-capture profile and composes into normal provider discovery", () => {
    expect(cookieCaptureProfile).toMatchObject({ origin: "https://chatgpt.com", cookieNames: ["__Secure-next-auth.session-token"], validationProbe: { method: "GET" } });
    expect(REGISTRY.find((entry) => entry.id === "chatgpt-web-codex")).toBe(codexProvider);
    expect(codexProvider.models.map(({ id }) => id)).toEqual(["luna", "think", "instant", "medium", "high", "extra-high", "pro"]);
  });

  it("validates sessions and rejects expired credentials", async () => {
    const ok = await probeRegistryProvider("chatgpt-web-codex", cookieA, async () => json({ user: { id: "fixture" } }));
    const bad = await probeRegistryProvider("chatgpt-web-codex", "expired", async () => json({ error: "unauthorized" }, 401));
    expect(ok).toMatchObject({ valid: true, status: 200 });
    expect(bad).toMatchObject({ valid: false, status: 401 });
  });

  it("discovers the static model catalog for a saved connection", async () => {
    const found = await fetchConnectionModels({ id: "codex-connection", provider: "chatgpt-web-codex", apiKey: cookieA });
    expect(found.models.map(({ id }) => id)).toEqual(["luna", "think", "instant", "medium", "high", "extra-high", "pro"]);
  });

  it.each([["openai", false], ["openai", true], ["claude", false], ["claude", true]])("routes %s %s requests through Codex lane mapping", async (format, stream) => {
    const body = format === "claude"
      ? { model: "think", max_tokens: 32, stream, messages: [{ role: "user", content: "hi" }] }
      : { model: "think", stream, messages: [{ role: "user", content: "hi" }] };
    const response = await chat(body, format);
    expect(response.success).toBe(true);
    expect(fakeHttp.execute).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-luna-free-thinking", credentials: expect.objectContaining({ apiKey: cookieA }) }));
    if (stream) expect(await response.response.text()).toContain("hello");
    else {
      const output = await response.response.json();
      if (format === "claude") expect(output.content[0].text).toBe("hello");
      else expect(output.choices[0].message.content).toBe("hello");
    }
  });

  it("maps expired-session and quota failures without losing their status", async () => {
    for (const [credential, status] of [["expired", 401], ["quota", 429]]) {
      const response = await chat({ model: "luna", messages: [{ role: "user", content: "hi" }] }, "openai", credential);
      expect(response.response.status).toBe(status);
    }
  });

  it("keeps two connections' session cookies isolated", async () => {
    const executor = new ChatGptWebCodexExecutor({ httpExecutor: fakeHttp });
    const base = { model: "luna", body: { model: "luna", messages: [] }, stream: false };
    await executor.execute({ ...base, credentials: { apiKey: cookieA, connectionId: "a", providerSpecificData: { transport: "http" } } });
    await executor.execute({ ...base, credentials: { apiKey: cookieB, connectionId: "b", providerSpecificData: { transport: "http" } } });
    expect(fakeHttp.execute.mock.calls.slice(-2).map(([input]) => input.credentials.apiKey)).toEqual([cookieA, cookieB]);
  });
});
