import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const upstream = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { default: entry } = await import("../../open-sse/providers/private/chatplayground.js");
  return { ...original, default: [...original.default.filter((row) => row.id !== entry.id), entry] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { ChatPlaygroundExecutor } = await import("../../open-sse/executors/chatplayground.js");
  const executor = new ChatPlaygroundExecutor(upstream.fetch);
  return { ...original, getExecutor: (id) => id === "chatplayground" || id === "cpl" ? executor : original.getExecutor(id) };
});
vi.mock("../../src/app/api/providers/[id]/models/modelsConfig.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, PROVIDER_MODELS_CONFIG: { ...original.PROVIDER_MODELS_CONFIG, chatplayground: {
    url: "https://app.chatplayground.ai/api/models", method: "GET", headers: {},
    buildHeaders: (_token, connection) => ({ Cookie: connection.apiKey }),
    parseResponse: (data) => (data?.data || data?.models || []).filter((row) => row?.botId).map((row) => ({ id: row.botId, name: row.displayName || row.modelName || row.botId })),
  } } };
});
vi.mock("@/lib/usageDb.js", () => ({
    appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: upstream.fetch }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ChatPlaygroundExecutor, createChatPlaygroundSseStream, discoverChatPlaygroundModels, validateChatPlaygroundCookie } from "../../open-sse/executors/chatplayground.js";
import provider, { chatplaygroundCookieProfile } from "../../open-sse/providers/private/chatplayground.js";
import { getCookieImportContract, buildImportedCookieHeader } from "../../src/lib/providers/cookieImport/contract.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

const SESSION_A = "eyJhbGciOiJub25lIn0.eyJzaWQiOiJzaWQtYSJ9.signature";
const SESSION_B = "eyJhbGciOiJub25lIn0.eyJzaWQiOiJzaWQtYiJ9.signature";
const COOKIE_A = `__client=client-a; __session=${SESSION_A}`;
const COOKIE_B = `__client=client-b; __session=${SESSION_B}`;
const MODEL = "gpt-6-luna";
const catalog = { data: [{ botId: MODEL, modelName: MODEL, displayName: "GPT 6 Luna", provider: "OpenAI", endpoint: "azure", group: "chat" }] };
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setUpstream(answer = "hello") {
  upstream.fetch.mockImplementation(async (url, init = {}) => {
    const mint = String(url).match(/\/sessions\/([^/]+)\/tokens/);
    if (mint) return json({ jwt: `jwt-${mint[1]}` });
    if (String(url).endsWith("/api/user")) return json({ id: "user" });
    if (String(url).endsWith("/api/models")) return json(catalog);
    if (String(url).includes("/api/chat/")) return new Response(answer);
    return json({}, 404);
  });
}

function chat(endpoint, body, cookie = COOKIE_A) {
  return handleChatCore({
    body, modelInfo: { provider: "chatplayground", model: body.model }, credentials: { apiKey: cookie, id: "cp-test" },
    clientRawRequest: { endpoint, body, headers: {} },
    sourceFormatOverride: endpoint === "/v1/messages" ? FORMATS.CLAUDE : FORMATS.OPENAI,
    connectionId: "cp-test", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
}

describe("staged ChatPlayground provider", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("composes into registry discovery and publishes a cookie import profile", () => {
    expect(REGISTRY.find((entry) => entry.id === provider.id)).toBe(provider);
    expect(PROVIDER_MODELS.cpl).toEqual([]);
    expect(provider).toMatchObject({ authType: "cookie", transport: { executor: "chatplayground" } });
    expect(chatplaygroundCookieProfile.cookieNames).toEqual(["__client", "__session"]);
    const contract = getCookieImportContract("chatplayground");
    expect(contract).toMatchObject({ origin: chatplaygroundCookieProfile.origin });
    expect(buildImportedCookieHeader(contract, [
      { name: "__client", value: "client-a", domain: ".chatplayground.ai", secure: true },
      { name: "__session", value: "session-a", domain: ".chatplayground.ai", secure: true },
    ]).ok).toBe(true);
  });

  it("validates valid and expired sessions with a closed mock", async () => {
    const valid = vi.fn(async (url) => String(url).includes("clerk") ? json({ jwt: "synthetic-clerk-jwt" }) : json({ id: "ok" }));
    await expect(validateChatPlaygroundCookie(COOKIE_A, valid)).resolves.toMatchObject({ valid: true, status: 200 });
    expect(valid.mock.calls[0][0]).toContain("clerk.chatplayground.ai/v1/client/sessions/sid-a/tokens");
    expect(valid.mock.calls[1][1].headers.Authorization).toBe("Bearer synthetic-clerk-jwt");
    const probeFetch = vi.fn(async () => json({ id: "ok" }));
    const validProbe = await probeRegistryProvider("chatplayground", COOKIE_A, probeFetch);
    expect(validProbe).toMatchObject({ valid: true, status: 200 });
    expect(probeFetch.mock.calls[0][1].headers.Cookie).toBe(COOKIE_A);
    const invalidProbe = await probeRegistryProvider("chatplayground", COOKIE_A, vi.fn(async () => json({}, 401)));
    expect(invalidProbe).toMatchObject({ valid: false, status: 401 });
    const expired = vi.fn(async (url) => String(url).includes("clerk") ? json({ error: "expired" }, 401) : json({ id: "valid" }));
    await expect(validateChatPlaygroundCookie(COOKIE_A, expired)).resolves.toMatchObject({ valid: false, status: 401 });
  });

  it("discovers live bot names through the normal connection model route", async () => {
    upstream.fetch.mockResolvedValue(json(catalog));
    const result = await fetchConnectionModels({ id: "cp-discovery", provider: "chatplayground", apiKey: COOKIE_A });
    expect(result.models).toEqual([{ id: MODEL, name: "GPT 6 Luna" }]);
  });

  it.each(["/v1/chat/completions", "/v1/messages"])("runs JSON and streamed responses through %s", async (endpoint) => {
    setUpstream("hello stream");
    const jsonBody = endpoint === "/v1/messages"
      ? { model: MODEL, max_tokens: 64, messages: [{ role: "user", content: "hi" }], stream: false }
      : { model: MODEL, messages: [{ role: "user", content: "hi" }], stream: false };
    const response = await chat(endpoint, jsonBody);
    expect(response.response.status).toBe(200);
    const payload = await response.response.json();
    expect(endpoint === "/v1/messages" ? payload.content[0].text : payload.choices[0].message.content).toBe("hello stream");
    const streamBody = { ...jsonBody, stream: true };
    const streamed = await chat(endpoint, streamBody);
    expect(await streamed.response.text()).toContain("hello stream");
  });

  it("keeps connection cookies isolated and maps auth/quota statuses", async () => {
    setUpstream();
    await new ChatPlaygroundExecutor(upstream.fetch).execute({ model: MODEL, body: { messages: [] }, stream: false, credentials: { apiKey: COOKIE_A } });
    await new ChatPlaygroundExecutor(upstream.fetch).execute({ model: MODEL, body: { messages: [] }, stream: false, credentials: { apiKey: COOKIE_B } });
    const chatCalls = upstream.fetch.mock.calls.filter(([url]) => String(url).includes("/api/chat/"));
    expect(chatCalls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer jwt-sid-a", "Bearer jwt-sid-b"]);
    upstream.fetch.mockImplementation(async (url) => String(url).includes("clerk") ? json({ jwt: "synthetic-clerk-jwt" }) : String(url).endsWith("/api/user") ? json({}, 403) : json({}, 429));
    const unauthorized = await new ChatPlaygroundExecutor(upstream.fetch).execute({ model: MODEL, body: {}, credentials: { apiKey: COOKIE_A } });
    expect(unauthorized.response.status).toBe(403);
    upstream.fetch.mockImplementation(async (url) => String(url).includes("clerk") ? json({}, 429) : json({}));
    const quota = await new ChatPlaygroundExecutor(upstream.fetch).execute({ model: MODEL, body: {}, credentials: { apiKey: COOKIE_A } });
    expect(quota.response.status).toBe(429);
  });

  it("discovers the live catalog for a valid imported cookie", async () => {
    setUpstream();
    await expect(discoverChatPlaygroundModels({ apiKey: COOKIE_A }, upstream.fetch)).resolves.toMatchObject({ models: [{ id: MODEL }] });
  });

  it("streams text while stripping a CHAT_ID marker split across network chunks", async () => {
    const source = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("hello CHAT_ID:ab"));
      controller.enqueue(new TextEncoder().encode("c123 world"));
      controller.close();
    } });
    const output = await new Response(createChatPlaygroundSseStream(source, MODEL)).text();
    expect(output).toContain("hello ");
    expect(output).toContain("world");
    expect(output).not.toContain("CHAT_ID");
    expect(output).toContain("data: [DONE]");
  });
});
