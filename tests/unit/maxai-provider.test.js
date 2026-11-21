import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const network = vi.hoisted(() => ({ fetch: vi.fn(), tls: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: network.fetch }));
vi.mock("../../open-sse/services/lmarenaTlsClient.js", () => ({ tlsFetchLMArena: network.tls }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({ ...(await original()), createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })) }));
// Compose staged entries/executors only in this test; production registration stays untouched.
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const maxai = await import("../../open-sse/providers/private/maxai.js");
  return { ...original, default: [...original.default, maxai.default] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const [{ MaxaiExecutor }, { LmarenaExecutor }] = await Promise.all([import("../../open-sse/executors/maxai.js"), import("../../open-sse/executors/lmarena.js")]);
  const maxai = new MaxaiExecutor();
  return { ...original, getExecutor: (id) => id === "maxai" ? maxai : original.getExecutor(id), hasSpecializedExecutor: (id) => id === "maxai" || original.hasSpecializedExecutor(id) };
});

import maxaiEntry, { cookieCaptureProfile } from "../../open-sse/providers/private/maxai.js";
import { MaxaiExecutor, validateMaxaiSession } from "../../open-sse/executors/maxai.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const key = "synthetic-maxai-access-token";
const credentials = { id: "maxai-conn", provider: "maxai", cookie: `access_token=${key}; device_id=device-a; user_id=user-a`, providerSpecificData: { maxaiSigningConstants: { hmacKey: "a".repeat(40), aesKey: "b".repeat(40), appVersion: "webpage_1.2.3", ctxKey: "c".repeat(40) } } };
const mockResponse = (status = 200, body = "") => new Response(body, { status, headers: { "content-type": "text/event-stream" } });
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function chat(provider, endpoint, stream, connection = credentials) {
  const body = endpoint === "/v1/messages" ? { model: "maxai/gpt-5.6", max_tokens: 64, messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }], stream } : { model: "maxai/gpt-5.6", messages: [{ role: "user", content: "hello" }], stream };
  return handleChatCore({ body, modelInfo: { provider, model: "gpt-5.6" }, credentials: connection, clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: endpoint === "/v1/messages" ? "claude" : "openai", connectionId: connection.id, log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("MaxAI staged provider", () => {
  it("declares browser cookie capture and the pinned static model catalog", () => {
    expect(cookieCaptureProfile.origin).toBe("https://www.maxai.co");
    expect(maxaiEntry.transport.executor).toBe("maxai");
    expect(getProviderModels("maxai").map((m) => m.id)).toContain("gpt-5.6");
  });
  it("validates a live session and rejects expired/missing sessions", async () => {
    network.fetch.mockResolvedValueOnce(mockResponse(200, "{}"));
    expect(await validateMaxaiSession(credentials, network.fetch)).toMatchObject({ valid: true, status: 200 });
    network.fetch.mockResolvedValueOnce(mockResponse(401, "expired"));
    expect(await validateMaxaiSession(credentials, network.fetch)).toMatchObject({ valid: false, status: 401 });
    expect(await validateMaxaiSession({ cookie: "" }, network.fetch)).toMatchObject({ valid: false });
  });
  it("uses the staged validation and static discovery routes", async () => {
    network.fetch.mockResolvedValue(mockResponse(200, "{}"));
    expect(await probeRegistryProvider("maxai", credentials.cookie, network.fetch, credentials.providerSpecificData)).toMatchObject({ valid: true });
    const result = await fetchConnectionModels({ id: credentials.id, provider: "maxai", cookie: credentials.cookie });
    expect(result).toMatchObject({ source: "local_catalog", connectionId: credentials.id });
    expect(result.models.map((m) => m.id)).toContain("gpt-5.6");
  });
  it.each([["/v1/chat/completions", false], ["/v1/chat/completions", true], ["/v1/messages", false], ["/v1/messages", true]])("routes %s stream=%s through the signed MaxAI request", async (endpoint, stream) => {
    const wire = `data: ${JSON.stringify({ text: "hello" })}\n\n`;
    network.fetch.mockResolvedValue(mockResponse(200, wire));
    const result = await chat("maxai", endpoint, stream);
    expect(result.success).toBe(true);
    const [url, init] = network.fetch.mock.calls.at(-1);
    expect(url).toBe("https://api.maxai.me/gpt/cwc/chat");
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.headers["X-Authorization"]).toBeTruthy();
    expect(JSON.parse(init.body)).toMatchObject({ model_name: "gpt-5.6", streaming: true });
    if (stream) expect(await result.response.text()).toContain("data:");
    else if (endpoint === "/v1/messages") expect(await result.response.json()).toMatchObject({ type: "message", content: [{ type: "text", text: "hello" }] });
    else expect(await result.response.json()).toMatchObject({ choices: [{ message: { content: "hello" } }] });
  });
  it.each([401, 403, 402, 429])("preserves credential/quota status %s", async (status) => {
    network.fetch.mockResolvedValue(mockResponse(status, "blocked"));
    const result = await new MaxaiExecutor().execute({ model: "gpt-5.6", body: { messages: [] }, credentials, stream: false });
    expect(result.response.status).toBe(status);
    if (status === 401 || status === 403) expect((await result.response.json()).error.type).toBe("authentication_error");
  });
  it("maps MaxAI's masked-expiry 418 response to a credential error", async () => {
    network.fetch.mockResolvedValue(mockResponse(418, "expired"));
    const result = await new MaxaiExecutor().execute({ model: "gpt-5.6", body: { messages: [] }, credentials, stream: false });
    expect(result.response.status).toBe(401);
  });
  it("keeps two browser sessions isolated", async () => {
    network.fetch.mockImplementation(async () => mockResponse(200, "data: {\"text\":\"ok\"}\n\n"));
    const second = { ...credentials, id: "maxai-conn-b", cookie: "access_token=other; device_id=device-b; user_id=user-b", providerSpecificData: credentials.providerSpecificData };
    await new MaxaiExecutor().execute({ model: "gpt-5.6", body: { messages: [] }, credentials, stream: false });
    await new MaxaiExecutor().execute({ model: "gpt-5.6", body: { messages: [] }, credentials: second, stream: false });
    expect(network.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
    expect(network.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer other");
  });
});
