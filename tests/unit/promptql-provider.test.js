import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("../../open-sse/providers/registry/index.js", async (original) => {
  const actual = await original();
  const { default: entry } = await import("../../open-sse/providers/private/promptql.js");
  return { ...actual, default: [...actual.default, entry] };
});
vi.mock("../../open-sse/executors/index.js", async (original) => {
  const actual = await original();
  const { PromptQlExecutor } = await import("../../open-sse/executors/promptql.js");
  const executor = new PromptQlExecutor();
  return { ...actual, getExecutor: (id) => id === "promptql" || id === "pql" ? executor : actual.getExecutor(id) };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { promptqlCookieProfile, PROMPTQL_MODELS } from "../../open-sse/providers/private/promptql.js";
import { PromptQlExecutor } from "../../open-sse/executors/promptql.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

const TOKEN_A = "synthetic.jwt.account-a";
const TOKEN_B = "synthetic.jwt.account-b";
const PROJECT = "synthetic-project-id";
const COOKIE_A = "next-auth.session-token=synthetic-a";
const COOKIE_B = "next-auth.session-token=synthetic-b";
const GQL = "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));
const gqlEventData = { type: "AgentMessage", content: "PromptQL says hello", final_response_sent: true };
const credentials = (apiKey, cookie) => ({ id: "pql-test", apiKey, authType: "cookie", providerSpecificData: { token: apiKey, cookie, projectId: PROJECT } });
afterEach(() => { vi.restoreAllMocks(); });

describe("PromptQL staged provider", () => {
  it("exposes the staged GraphQL transport, fallback catalog, and cookie-import profile", () => {
    expect(REGISTRY.find((x) => x.id === "promptql")).toBeDefined();
    expect(PROVIDERS.promptql).toMatchObject({ baseUrl: GQL, executor: "promptql", authType: "cookie" });
    expect(getProviderModels("promptql").map((x) => x.id)).toEqual(PROMPTQL_MODELS.map((x) => x.id));
    expect(promptqlCookieProfile.cookieNames).toContain("next-auth.session-token");
    expect(promptqlCookieProfile.validationProbe.method).toBe("POST");
    expect(getCookieImportContract("promptql")).toMatchObject({ origin: "https://prompt.ql.app" });
  });

  it("discovers models for a connection using only that connection's JWT", async () => {
    routedFetch.mockResolvedValue(json({ data: { llm_config: [{ id: "synthetic-config", display_label: "Synthetic Model", model_reference: "synthetic-model" }] } }));
    const models = await fetchConnectionModels({ id: "pql-a", provider: "promptql", apiKey: TOKEN_A, providerSpecificData: { token: TOKEN_A, projectId: PROJECT } });
    expect(models).toMatchObject({ provider: "promptql", models: [{ id: "synthetic-model", name: "Synthetic Model" }] });
    expect(routedFetch.mock.calls[0][0]).toBe(GQL);
    expect(routedFetch.mock.calls[0][1].headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(getProviderModels("promptql")).toEqual(PROMPTQL_MODELS);
  });

  it("validates accepted and rejected session probes", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ token: "synthetic-project-jwt" })).mockResolvedValueOnce(json({ error: "expired" }, 401));
    expect(await probeRegistryProvider("promptql", COOKIE_A, fetcher)).toMatchObject({ valid: true, status: 200 });
    expect(await probeRegistryProvider("promptql", COOKIE_A, fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls[0][0]).toBe(promptqlCookieProfile.validationProbe.url);
  });

  it.each([["/v1/chat/completions", FORMATS.OPENAI], ["/v1/messages", FORMATS.CLAUDE]])("routes JSON and streamed turns through %s", async (endpoint, format) => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init]);
      const payload = JSON.parse(init.body || "{}");
      if (payload.operationName === "FetchLlmConfigs") return json({ data: { llm_config: [{ id: "synthetic-config", model_reference: "gemini-3.7-flash", display_label: "Gemini Flash" }] } });
      if (payload.operationName === "StartThreadWithModel" || payload.operationName === "StartThreadRoomless") return json({ data: { start_thread: { thread_id: "synthetic-thread", thread_events: [] } } });
      if (payload.operationName === "SendThreadMessage") return json({ data: { send_thread_message: { thread_event_id: 1 } } });
      if (payload.operationName === "QueryThreadEvents") return json({ data: { thread_events: [{ thread_event_id: 2, event_data: gqlEventData }] } });
      throw new Error(`unexpected mocked URL or operation ${url} ${payload.operationName}`);
    });
    try {
      for (const stream of [false, true]) {
        const body = endpoint === "/v1/messages" ? { model: "promptql/gemini-3.7-flash", max_tokens: 40, messages: [{ role: "user", content: "hi" }], stream } : { model: "promptql/gemini-3.7-flash", messages: [{ role: "user", content: "hi" }], stream };
        const result = await handleChatCore({ body, modelInfo: { provider: "promptql", model: "gemini-3.7-flash" }, credentials: credentials(TOKEN_A, COOKIE_A), clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "pql-test", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
        expect(result.response.status).toBe(200);
        expect(await result.response.text()).toContain("PromptQL says hello");
      }
      expect(calls.filter(([, init]) => JSON.parse(init.body).operationName === "StartThreadWithModel").length).toBeGreaterThanOrEqual(2);
      expect(calls.every(([url, init]) => url === GQL && init.headers.authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    } finally { globalThis.fetch = original; }
  });

  it("maps expired sessions and 429 quota responses", async () => {
    const expired = new PromptQlExecutor({ fetch: vi.fn(async () => json({ errors: [{ message: "JWT expired" }] }, 401)) });
    const a = await expired.execute({ model: "model", body: { messages: [{ role: "user", content: "hi" }] }, credentials: credentials(TOKEN_A, COOKIE_A) });
    expect(a.response.status).toBe(401);
    const limited = new PromptQlExecutor({ fetch: vi.fn(async () => json({ errors: [{ message: "quota exceeded" }] }, 429)) });
    const b = await limited.execute({ model: "model", body: { messages: [{ role: "user", content: "hi" }] }, credentials: credentials(TOKEN_A, COOKIE_A) });
    expect(b.response.status).toBe(429);
  });

  it("keeps two connections' tokens, cookies, and projects isolated", async () => {
    const seen = [];
    const executor = new PromptQlExecutor({ fetch: vi.fn(async (_url, init) => { const body = JSON.parse(init.body); seen.push([init.headers.authorization, init.headers.cookie, body.variables.projectId, body.operationName]); if (body.operationName === "StartThreadRoomless") return json({ data: { start_thread: { thread_id: "one", thread_events: [] } } }); return json({ data: { thread_events: [{ thread_event_id: 2, event_data: gqlEventData }] } }); }) });
    await executor.execute({ model: "model", body: { messages: [{ role: "user", content: "hi" }] }, credentials: credentials(TOKEN_A, COOKIE_A) });
    await executor.execute({ model: "model", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { ...credentials(TOKEN_B, COOKIE_B), providerSpecificData: { ...credentials(TOKEN_B, COOKIE_B).providerSpecificData, projectId: "synthetic-project-b" } } });
    const startCalls = seen.filter((call) => call[3] === "StartThreadRoomless");
    expect(startCalls[0][0]).toBe(`Bearer ${TOKEN_A}`); expect(startCalls[1][0]).toBe(`Bearer ${TOKEN_B}`);
    expect(startCalls[0][2]).toBe(PROJECT); expect(startCalls[1][2]).toBe("synthetic-project-b");
  });
});
