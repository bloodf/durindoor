/**
 * #1168 offline scope: installed codex/cx uses account-scoped HTTP Responses,
 * not the candidate codex-app-server local JSON-RPC transport. Synthetic fetch
 * fixtures prove wire behavior only, never account access or vendor support.
 * App-server, g4f, and web identities cannot inherit native Codex capabilities.
 * Live acceptance requires account-backed endpoint/auth/model/tool/stream proof;
 * unavailable candidate capabilities must remain hidden until that proof exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline",
  updateKimchiUserAgent: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { testSingleConnection, __setProviderTestFetchForTesting } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const connection = {
  id: "offline-codex-account",
  provider: "codex",
  authType: "oauth",
  accessToken: "offline-fixture-token",
  providerSpecificData: { accountId: "offline-account" },
};
const credentials = {
  accessToken: connection.accessToken,
  connectionId: connection.id,
  providerSpecificData: connection.providerSpecificData,
};
const model = "gpt-5.3-codex";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const sse = (events) => new Response(events.map((event) =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
).join(""), { headers: { "Content-Type": "text/event-stream" } });
let restoreFetch;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnectionById.mockResolvedValue(connection);
  mocks.updateProviderConnection.mockResolvedValue(undefined);
  mocks.resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: false });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network forbidden"); }));
  restoreFetch = __setProviderTestFetchForTesting(proxyAwareFetch);
});
afterEach(() => {
  restoreFetch();
  vi.unstubAllGlobals();
});

describe("#1168 native HTTP comparison does not prove local app-server support", () => {
  it("validates then discovers the selected native account without accepting local RPC models", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ error: "empty input" }, 400))
      .mockResolvedValueOnce(json({ models: [{ slug: model, display_name: "Offline Codex" }] }));
    expect(await testSingleConnection(connection.id)).toMatchObject({ valid: true });
    expect(await fetchConnectionModels(connection)).toMatchObject({
      models: expect.arrayContaining([expect.objectContaining({ id: model })]),
    });
    const [[probeUrl, probe], [modelsUrl, discovery]] = proxyAwareFetch.mock.calls;
    expect(probeUrl).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(probe.method).toBe("POST");
    expect(JSON.parse(probe.body)).toMatchObject({ input: [], stream: false, store: false });
    expect(modelsUrl).toMatch(/^https:\/\/chatgpt\.com\/backend-api\/codex\/models\?client_version=/);
    for (const request of [probe, discovery]) {
      expect(request.headers).toMatchObject({
        Authorization: "Bearer offline-fixture-token", "ChatGPT-Account-ID": "offline-account",
      });
    }
    proxyAwareFetch.mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 1, result: { data: [{ id: model }] } }));
    expect(await fetchConnectionModels(connection)).toMatchObject({ models: [] });
  });

  it("sends native tool history over HTTP and preserves tool argument SSE, not JSON-RPC turns", async () => {
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_offline", call_id: "call_offline", name: "read_file", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_offline", output_index: 0, delta: '{"path":"README.md"}' },
      { type: "response.completed", response: { id: "resp_offline", status: "completed" } },
    ];
    proxyAwareFetch.mockResolvedValueOnce(sse(events));
    const result = await getExecutor("codex").execute({
      model, stream: true, credentials,
      body: {
        model, input: [
          { type: "function_call", call_id: "call_previous", name: "read_file", arguments: '{"path":"README.md"}' },
          { type: "function_call_output", call_id: "call_previous", output: "offline contents" },
          { role: "user", content: "Read again" },
        ],
        tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
      },
    });
    const [url, request] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(request.headers).toMatchObject({ Authorization: "Bearer offline-fixture-token", "ChatGPT-Account-ID": "offline-account" });
    const wire = JSON.parse(request.body);
    expect(wire).toMatchObject({ model, stream: true, store: false });
    expect(wire.input).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call_previous", output: "offline contents" }));
    expect(wire.tools).toContainEqual(expect.objectContaining({ type: "function", name: "read_file" }));
    expect(wire).not.toHaveProperty("jsonrpc");
    const text = await result.response.text();
    for (const event of events) expect(text).toContain(JSON.stringify(event));
  });

  it("does not mistake revoked native account credentials for usable app-server access", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    expect(await testSingleConnection(connection.id)).toMatchObject({ valid: false, error: "Token invalid or revoked" });
    proxyAwareFetch.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    expect(await fetchConnectionModels(connection)).toMatchObject({ status: 401 });
    proxyAwareFetch.mockResolvedValueOnce(json({ error: { message: "unauthorized", type: "authentication_error" } }, 401));
    const result = await getExecutor("codex").execute({ model, body: { model, input: [] }, stream: true, credentials });
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({ error: { type: "authentication_error" } });
  });

  it("keeps candidate identity absent and rejects validation/discovery without HTTP traffic", async () => {
    expect(AI_PROVIDERS["codex-app-server"]).toBeUndefined();
    expect(hasSpecializedExecutor("codex-app-server")).toBe(false);
    mocks.getProviderConnectionById.mockResolvedValue({ ...connection, provider: "codex-app-server" });
    expect(await testSingleConnection(connection.id)).toMatchObject({ valid: false, error: "Provider test not supported" });
    expect(await fetchConnectionModels({ ...connection, provider: "codex-app-server" })).toMatchObject({ status: 400 });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported local app-server execution before dispatching credentials to an unrelated HTTP vendor", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ choices: [] }));
    const executor = getExecutor("codex-app-server");
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    try {
      const execution = executor.execute({
        model, stream: false, credentials,
        body: { model, messages: [{ role: "user", content: "Offline local transport boundary" }] },
      });
      await expect(execution).rejects.toBeInstanceOf(Error);
      await expect(execution).rejects.toMatchObject({
        status: 400,
        message: 'Unknown provider "codex-app-server": no supported transport endpoint',
      });
      expect(buildHeaders).not.toHaveBeenCalled();
      expect(proxyAwareFetch, "Unsupported local transport must not leak credentials to OpenAI HTTP fallback").not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      buildHeaders.mockRestore();
    }
  });
});
