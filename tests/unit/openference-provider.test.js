import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ transport: vi.fn(), save: vi.fn(), usage: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: mocks.transport }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "fixture", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.save, getProxyPoolById: vi.fn(), getProviderNodeById: vi.fn(), updateProviderConnection: vi.fn(), getProviderConnectionById: vi.fn() }));
vi.mock("@/lib/oauth/utils/server", () => ({ clearCodexSession: vi.fn(), clearXaiSession: vi.fn(), getCodexSessionStatus: vi.fn(), getXaiSessionStatus: vi.fn(), registerCodexSession: vi.fn(), registerXaiSession: vi.fn(), startCodexProxy: vi.fn(), startXaiProxy: vi.fn(), stopCodexProxy: vi.fn(), stopXaiProxy: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: mocks.usage }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({ ...(await original()), createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })) }));

import { POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { refreshOpenferenceToken } from "../../open-sse/services/openferenceAuth.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

const post = (action, body) => POST({ json: async () => body }, { params: Promise.resolve({ provider: "openference", action }) });
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => { clearOAuthFlowsForTests(); mocks.transport.mockReset(); mocks.save.mockReset(); mocks.usage.mockReset().mockResolvedValue(); vi.stubEnv("OPENFERENCE_OAUTH_CLIENT_ID", "fixture-client"); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network"); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearOAuthFlowsForTests(); });

describe("Openference OAuth", () => {
  it("binds PKCE and rejects bad state before exchanging or saving; exchanges the bound callback once", async () => {
    const begin = await post("authorize", { redirectUri: "http://localhost:8080/callback", proxyMode: "direct", meta: { clientId: "untrusted" } });
    expect(begin.status).toBe(200);
    const flow = await begin.json();
    const auth = new URL(flow.authUrl);
    expect(auth.searchParams.get("client_id")).toBe("fixture-client");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    const bad = await post("exchange", { flowId: flow.flowId, state: "wrong", code: "code" });
    expect(bad.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
    mocks.save.mockImplementation(async (data) => ({ id: "connection", ...data }));
    vi.stubEnv("OPENFERENCE_OAUTH_CLIENT_ID", "changed-client");
    const done = await post("exchange", { flowId: flow.flowId, state: flow.state, code: "eyJ.fixture.code" });
    expect(done.status).toBe(200);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://openference.com/oauth/token");
    expect(init.body.get("client_id")).toBe("fixture-client");
    expect(init.body.get("redirect_uri")).toBe("http://localhost:8080/callback");
    expect(init.body.get("code_verifier")).toBeTruthy();
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ provider: "openference", authType: "oauth", accessToken: "access", providerSpecificData: { clientId: "fixture-client" } });
    expect((await post("exchange", { flowId: flow.flowId, state: flow.state, code: "code" })).status).toBe(410);
  });
  it("refreshes only with the connection's client and route, and fails closed", async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 10 }));
    const connection = { refreshToken: "old", providerSpecificData: { clientId: "client-a" } };
    expect(await refreshOpenferenceToken(connection, log, { disableEnvProxy: true })).toMatchObject({ accessToken: "new", refreshToken: "rotated" });
    expect(mocks.transport.mock.calls[0][1].body.get("client_id")).toBe("client-a");
    expect(mocks.transport.mock.calls[0][2]).toEqual({ disableEnvProxy: true });
    expect(await refreshOpenferenceToken({ refreshToken: "old" }, log)).toBeNull();
    mocks.transport.mockResolvedValueOnce(new Response("error", { status: 401 }));
    expect(await refreshOpenferenceToken({ refreshToken: "different", providerSpecificData: { clientId: "client-b" } }, log)).toBeNull();
  });
  it("isolates identical refresh tokens by client and reports discovery failures", async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ access_token: "one" })).mockResolvedValueOnce(Response.json({ access_token: "two" }));
    const [one, two] = await Promise.all([
      refreshOpenferenceToken({ refreshToken: "shared", providerSpecificData: { clientId: "one" } }, log),
      refreshOpenferenceToken({ refreshToken: "shared", providerSpecificData: { clientId: "two" } }, log),
    ]);
    expect([one.accessToken, two.accessToken]).toEqual(["one", "two"]);
    expect(mocks.transport).toHaveBeenCalledTimes(2);
    mocks.transport.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect(await fetchConnectionModels({ id: "one", provider: "openference", accessToken: "access", providerSpecificData: {} })).toMatchObject({ status: 403 });
  });
  it("discovers using the OAuth access token and keeps the API-key alias distinct", async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ data: [{ id: "fixture-model" }] }));
    const result = await fetchConnectionModels({ id: "one", provider: "openference", accessToken: "access", providerSpecificData: {} });
    expect(result.models).toEqual([{ id: "fixture-model" }]);
    expect(mocks.transport.mock.calls[0][1].headers.Authorization).toBe("Bearer access");
    expect(resolveProviderAlias("of")).toBe("openference");
    expect(resolveProviderAlias("ofa")).toBe("openference-api");
  });
  it("preserves upstream authorization failures through chat", async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ error: { message: "denied" } }, { status: 403 }));
    const body = { model: "fixture-model", stream: false, messages: [{ role: "user", content: "hi" }] };
    const result = await handleChatCore({ body, modelInfo: { provider: "openference", model: "fixture-model" }, credentials: { accessToken: "access" }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: "one", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(403);
    expect(mocks.transport).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("routes tool requests and usage in JSON/SSE (stream=%s)", async (stream) => {
    const usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 };
    const reply = { id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage };
    const frames = `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`;
    mocks.transport.mockResolvedValueOnce(stream ? new Response(frames, { headers: { "Content-Type": "text/event-stream" } }) : Response.json(reply));
    const body = { model: "fixture-model", stream, messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }] };
    const result = await handleChatCore({ body, modelInfo: { provider: "openference", model: "fixture-model" }, credentials: { accessToken: "access" }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: "one", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(true);
    expect(mocks.transport.mock.calls[0][0]).toBe("https://api.openference.com/v1/chat/completions");
    expect(mocks.transport.mock.calls[0][1].headers.Authorization).toBe("Bearer access");
    expect(JSON.parse(mocks.transport.mock.calls[0][1].body).tools).toEqual(body.tools);
    const received = await result.response.text();
    expect(received).toContain('"completion_tokens":3');
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ provider: "openference", model: "fixture-model", connectionId: "one", tokens: expect.objectContaining({ completion_tokens: 3 }) }));
  });
});
