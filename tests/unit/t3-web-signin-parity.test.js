import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getProviderConnectionById, saveRequestDetail, updateProviderConnection, logTargetRequest, getProviderConnections } = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnections: vi.fn(async () => []),
  updateProviderConnection: vi.fn(async () => {}),
  logTargetRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById }));
vi.mock("@/lib/localDb", async (importOriginal) => ({
  ...await importOriginal(),
  getProviderConnectionById,
  getProviderConnections,
  getSettings: async () => ({ requireApiKey: false }),
  updateProviderConnection,
}));
vi.mock("open-sse/utils/requestLogger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRequestLogger: async (...args) => ({
      ...await actual.createRequestLogger(...args),
      logTargetRequest,
    }),
  };
});
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/usageDb.js", () => ({
  recordTokenSaverEvent: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail,
  saveRequestUsage: vi.fn(async () => {}),
}));

import { POST as chatRoute } from "@/app/api/v1/chat/completions/route.js";
import { POST as validate } from "@/app/api/providers/validate/route.js";
import { POST as testConnection } from "@/app/api/providers/[id]/test/route.js";
import { canDiscoverModels } from "@/app/api/providers/route.js";
import { GET as listModels } from "@/app/api/providers/[id]/models/route.js";
import { getExecutor } from "open-sse/executors/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { parseModel } from "open-sse/services/model.js";
import { initTranslators } from "open-sse/translator/index.js";
import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";

const direct = { oauthProxy: { mode: "direct", poolId: null } };
const sessions = ["convex-session-id=fake-alpha; sessionToken=fake-a", "cookies=sessionToken=fake-b\nconvexSessionId=fake-beta"];
const model = "t3/claude-opus-4";
const messages = [{ role: "user", content: "Hello" }];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };
const outbound = vi.fn();
let restoreFetch;

beforeEach(() => {
  vi.clearAllMocks();
  outbound.mockReset().mockImplementation(async () => { throw new Error("Unexpected outbound request"); });
  vi.stubGlobal("fetch", outbound);
  restoreFetch = __setOriginalFetchForTesting(outbound);
});
afterEach(() => {
  restoreFetch();
  vi.unstubAllGlobals();
});

function validateSession(apiKey) {
  return validate(new Request("http://localhost/api/providers/validate", {
    method: "POST",
    body: JSON.stringify({ provider: "t3-web", apiKey }),
  }));
}

it("checks session input through the provider validator and rejects redirects and unauthorized sessions", async () => {
  for (const input of ["sessionToken=fake", "convex-session-id=", "convex-session-id=a; convex-session-id=b",
    "convex-session-id=a\r\nAuthorization: Bearer fake"]) {
    expect((await (await validateSession(input)).json()).valid).toBe(false);
  }
  expect(outbound).not.toHaveBeenCalled();

  for (const status of [200, 302, 401, 403]) {
    outbound.mockImplementationOnce(async (url, options) => {
      expect(url).toBe("https://t3.chat/");
      expect(options).toMatchObject({ method: "HEAD", redirect: "error" });
      expect(new Headers(options.headers).get("cookie")).toBe("sessionToken=fake-b; convex-session-id=fake-beta");
      return new Response(null, { status });
    });
    const response = await validateSession(sessions[1]);
    expect(await response.json()).toMatchObject({ valid: status === 200 });
  }
  expect(outbound).toHaveBeenCalledTimes(4);
});

it("tests a stored cookie without putting it in the persisted test result", async () => {
  getProviderConnectionById.mockResolvedValueOnce({
    id: "connection-a", provider: "t3-web", authType: "cookie", apiKey: sessions[0], providerSpecificData: direct,
  });
  outbound.mockImplementationOnce(async (url, options) => {
    expect(url).toBe("https://t3.chat/");
    expect(new Headers(options.headers).get("cookie")).toBe(sessions[0]);
    return new Response(null, { status: 403 });
  });
  const response = await testConnection(new Request("http://localhost/api/providers/connection-a/test", {
    method: "POST",
  }), { params: Promise.resolve({ id: "connection-a" }) });
  expect(await response.json()).toMatchObject({ valid: false, error: "T3 Chat rejected the session." });
  expect(updateProviderConnection).toHaveBeenCalledExactlyOnceWith("connection-a", expect.objectContaining({ testStatus: "error" }));
  expect(JSON.stringify(updateProviderConnection.mock.calls)).not.toContain("fake-alpha");
  expect(outbound).toHaveBeenCalledTimes(1);
});

it("discovers the connection's local catalog without transmitting session credentials", async () => {
  expect(canDiscoverModels({ provider: "t3-web" })).toBe(true);
  getProviderConnectionById.mockResolvedValueOnce({
    id: "connection-a", provider: "t3-web", apiKey: sessions[0], providerSpecificData: direct,
  });
  const response = await listModels(new Request("http://localhost/api/providers/connection-a/models"), {
    params: Promise.resolve({ id: "connection-a" }),
  });
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({
    source: "local_catalog",
    models: expect.arrayContaining([expect.objectContaining({ id: "claude-opus-4" })]),
  });
  expect(JSON.stringify(payload)).not.toContain("fake-alpha");
  expect(outbound).not.toHaveBeenCalled();
});

function chat(apiKey, stream, connectionId) {
  const body = { model, messages, stream };
  return handleChatCore({
    body, modelInfo: parseModel(model), credentials: { apiKey, providerSpecificData: direct },
    connectionId, log,
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: stream ? "text/event-stream" : "application/json" } },
  });
}

it("routes chat through the specialized executor and isolates concurrent sessions", async () => {
  await initTranslators();
  outbound.mockImplementation(async (url, options) => {
    expect(url).toBe("https://t3.chat/api/chat");
    expect(options).toMatchObject({ method: "POST", redirect: "error" });
    const headers = new Headers(options.headers);
    expect(headers.has("authorization")).toBe(false);
    const body = JSON.parse(options.body);
    expect(body).toEqual({ model: "claude-opus-4", messages, stream: body.stream });
    expect(headers.get("cookie")).toBe(body.stream
      ? "sessionToken=fake-b; convex-session-id=fake-beta"
      : sessions[0]);
    if (body.stream) {
      return new Response('data: {"id":"fake-chat","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"second answer"}}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream", "Set-Cookie": "fake-beta" },
      });
    }
    return Response.json({ id: "fake-chat", choices: [{ message: { role: "assistant", content: "first answer" }, finish_reason: "stop" }] });
  });
  const [first, second] = await Promise.all([chat(sessions[0], false, "connection-a"), chat(sessions[1], true, "connection-b")]);
  expect(first.response.status).toBe(200);
  expect(second.response.status).toBe(200);
  expect(await first.response.text()).toContain("first answer");
  expect(await second.response.text()).toContain("second answer");
  expect(second.response.headers.has("set-cookie")).toBe(false);
  expect(outbound).toHaveBeenCalledTimes(2);
  expect(logTargetRequest).toHaveBeenCalledTimes(2);
  for (const [, headers] of logTargetRequest.mock.calls) {
    expect(new Headers(headers).has("cookie")).toBe(false);
  }
  const recorded = JSON.stringify([...Object.values(log).flatMap((fn) => fn.mock.calls),
    ...saveRequestDetail.mock.calls, ...logTargetRequest.mock.calls]);
  expect(recorded).not.toMatch(/fake-alpha|fake-beta/);
});

it("keeps credentials out of executor previews, telemetry headers and upstream errors", async () => {
  const executor = getExecutor("t3chat");
  const credentials = { apiKey: sessions[0], providerSpecificData: { baseUrl: "https://elsewhere.invalid" } };
  expect(JSON.stringify(executor.buildHeaders(credentials))).not.toContain("fake-alpha");
  outbound.mockResolvedValueOnce(Response.json({ error: { message: sessions[0] } }, { status: 401 }));
  const result = await executor.execute({ model: "claude-opus-4", body: { messages }, credentials, log });
  expect(result.response.status).toBe(401);
  expect(JSON.stringify(result.headers) + await result.response.text()).not.toContain("fake-alpha");
  expect(outbound).toHaveBeenCalledExactlyOnceWith("https://t3.chat/api/chat", expect.objectContaining({ redirect: "error" }));
});

it.each([true, false])("adapts T3 text events to OpenAI responses with stream=%s", async (stream) => {
  await initTranslators();
  outbound.mockImplementationOnce(async (_url, { body }) => {
    expect(JSON.parse(body).stream).toBe(stream);
    return new Response('{"text":"mock "}\n{"t":10,"p":{"k":["content"],"v":[{"t":2,"s":"answer"}]}}\n{"done":true}', {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  });
  const { response } = await chat(sessions[0], stream, "connection-a");
  expect(response.status).toBe(200);
  if (stream) {
    const text = await response.text();
    expect(text).toContain('"content":"mock "');
    expect(text).toContain('"content":"answer"');
    expect(text).toContain("[DONE]");
  } else {
    expect((await response.json()).choices[0].message.content).toBe("mock answer");
  }
  expect(outbound).toHaveBeenCalledTimes(1);
});

it("keeps credentials out of transport failure messages and refuses relay egress", async () => {
  const executor = getExecutor("t3-web");
  const input = { body: { messages }, credentials: { apiKey: sessions[0] } };
  const blocked = await executor.execute({ ...input, proxyOptions: { vercelRelayUrl: "https://elsewhere.invalid" } });
  expect(blocked.response.status).toBe(400);
  expect(outbound).not.toHaveBeenCalled();

  outbound.mockRejectedValueOnce(new Error(sessions[0]));
  const failed = await executor.execute(input);
  expect(failed.response.status).toBe(502);
  expect(await failed.response.text()).not.toContain("fake-alpha");
  expect(outbound).toHaveBeenCalledTimes(1);
});


it("uses the saved web cookie through the public chat completions route", async () => {
  getProviderConnections.mockImplementation(async ({ provider } = {}) => provider === "t3-web" ? [{
    id: "connection-route", provider, authType: "cookie", apiKey: sessions[0], isActive: true,
    providerSpecificData: direct,
  }] : []);
  outbound.mockImplementationOnce(async (url, options) => {
    expect(url).toBe("https://t3.chat/api/chat");
    expect(new Headers(options.headers).get("cookie")).toBe(sessions[0]);
    return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: "gateway answer" }, finish_reason: "stop" }] });
  });
  const response = await chatRoute(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  }));
  const text = await response.text();
  expect(response.status, text).toBe(200);
  expect(text).toContain("gateway answer");
  expect(text).not.toContain("fake-alpha");
  expect(outbound).toHaveBeenCalledTimes(1);
});
