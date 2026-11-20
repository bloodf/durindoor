import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("@/dashboardGuard", async (original) => ({ ...await original(), canManageAccessConfig: async () => true, isOperatorRequest: async () => true }));

const fixtures = [
  { name: "gemma", port: 11435, model: "mlx-community/gemma-4-26B-A4B-it-qat-q4_0-mlx-aligned", stream: false },
  { name: "qwen", port: 11436, model: "maglun/Qwen3.8-27B-MLX-Mixed-3.80bpw", stream: true },
];
const traffic = [];
let directory, adapter, restoreFetch;
async function mockFetch(input, options) {
  const request = new Request(input, options);
  const url = new URL(request.url);
  const fixture = fixtures.find((item) => url.hostname === "localhost" && url.port === String(item.port));
  if (!fixture || !["/v1/models", "/v1/chat/completions"].includes(url.pathname)) throw new Error(`Unexpected outbound request ${request.url}`);
  const body = request.method === "POST" ? await request.json() : null;
  traffic.push({ name: fixture.name, authorization: request.headers.get("authorization"), body });
  if (!body) return Response.json({ data: [{ id: fixture.model }] });
  if (body.model !== fixture.model) return Response.json({ error: "wrong model" }, { status: 400 });
  const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };
  const envelope = { id: `chatcmpl-${fixture.name}`, model: fixture.model, created: 1 };
  if (body.stream && !body.stream_options?.include_usage) throw new Error("stream usage was not requested");
  if (!body.stream) return Response.json({ ...envelope, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: fixture.name }, finish_reason: "stop" }], usage });
  const frames = [
    { ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: fixture.name }, finish_reason: null }] },
    { ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { ...envelope, object: "chat.completion.chunk", choices: [], usage },
  ];
  return new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
function request(endpoint, { key, connectionId, body } = {}) {
  const headers = new Headers();
  if (key) headers.set("authorization", `Bearer ${key}`);
  if (connectionId) headers.set("x-connection-id", connectionId);
  if (body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${endpoint}`, { headers, method: body ? "POST" : "GET", body: body && JSON.stringify(body) });
}
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mlx-"));
  vi.stubEnv("HOME", directory); vi.stubEnv("DATA_DIR", path.join(directory, "data"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite"); vi.stubEnv("DURINDOOR_PG_URL", undefined);
  vi.stubGlobal("fetch", mockFetch);
  restoreFetch = (await import("open-sse/utils/proxyFetch.js")).__setOriginalFetchForTesting(mockFetch);
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  await (await import("@/lib/db/repos/settingsRepo.js")).updateSettings({ requireApiKey: true, enableProxyTimeline: false });
});
afterAll(async () => {
  try { await disposeLoadedRequestDetailsRepo(); await adapter?.close?.(); }
  finally { restoreFetch?.(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); }
});
it("creates, discovers, pins and accounts for both MLX connections through gateway routes", async () => {
  const { POST: createConnection } = await import("@/app/api/providers/route.js");
  const { GET: discover } = await import("@/app/api/providers/[id]/models/route.js");
  const { POST: chat } = await import("@/app/api/v1/chat/completions/route.js");
  const { createApiKey, getApiKeyUsageTotals } = await import("@/lib/db/index.js");
  const connections = [];
  for (const fixture of fixtures) {
    const saved = await createConnection(request("/api/providers", { body: { provider: "mlx", name: fixture.name, apiKey: `synthetic-${fixture.name}`, providerSpecificData: { baseUrl: `http://localhost:${fixture.port}/v1` } } }));
    expect(saved.status).toBe(201);
    const { connection } = await saved.json();
    const client = await createApiKey(fixture.name, "fixture-machine", [], null, null, { providerConnectionIds: [connection.id] });
    const result = await discover(request(`/api/providers/${connection.id}/models`), { params: { id: connection.id } });
    expect(result.status).toBe(200);
    expect((await result.json()).models).toEqual([{ id: fixture.model }]);
    connections.push({ ...fixture, connection, client });
  }
  for (const fixture of connections) {
    const result = await chat(request("/v1/chat/completions", { key: fixture.client.key, connectionId: fixture.connection.id, body: { model: `mlx/${fixture.model}`, messages: [{ role: "user", content: "Hi" }], stream: fixture.stream, ...(fixture.stream ? { stream_options: { include_usage: true } } : {}) } }));
    expect(result.status).toBe(200);
    expect(await result.text()).toContain(fixture.name);
  }
  const beforeDenied = traffic.length;
  const denied = await chat(request("/v1/chat/completions", { key: connections[0].client.key, connectionId: connections[1].connection.id, body: { model: `mlx/${connections[0].model}`, messages: [{ role: "user", content: "Hi" }] } }));
  expect(denied.status).toBe(400);
  expect(traffic).toHaveLength(beforeDenied);
  await vi.waitFor(async () => {
    for (const fixture of connections) expect(await getApiKeyUsageTotals(fixture.client.id)).toMatchObject({ totalTokens: 10, totalRequests: 1 });
    expect(adapter.all("SELECT connectionId, model FROM usageHistory")).toEqual(expect.arrayContaining(connections.map((f) => ({ connectionId: f.connection.id, model: f.model }))));
  });
  for (const fixture of connections) expect(traffic).toContainEqual(expect.objectContaining({ name: fixture.name, authorization: `Bearer synthetic-${fixture.name}`, body: expect.objectContaining({ model: fixture.model, stream: fixture.stream }) }));
});
