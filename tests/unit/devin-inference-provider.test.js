import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// The setup routes run as an operator. Client gateway auth and accounting are real.
vi.mock("@/dashboardGuard", async (importOriginal) => ({
  ...await importOriginal(),
  canManageAccessConfig: async () => true,
  isOperatorRequest: async () => true,
}));

const proxyOrigin = "http://127.0.0.1:8317";
const prefix = "devin-proxy";
const model = "devin/fixture";
const accounts = [
  { name: "alpha", proxyKey: "fixture-proxy-alpha", stream: false, prompt: 7, completion: 3 },
  { name: "beta", proxyKey: "fixture-proxy-beta", stream: true, prompt: 11, completion: 5 },
];
const traffic = [];
const unexpected = [];
let directory, adapter, restoreFetch;

function proxyFixture(input, options) {
  const request = new Request(input, options);
  const route = `${request.method} ${request.url}`;
  if (![`GET ${proxyOrigin}/v1/models`, `POST ${proxyOrigin}/v1/chat/completions`].includes(route)) {
    unexpected.push(route);
    throw new Error(`Unexpected outbound request: ${route}`);
  }
  return respond(request);
}

async function respond(request) {
  const authorization = request.headers.get("authorization");
  const account = accounts.find(({ proxyKey }) => authorization === `Bearer ${proxyKey}`);
  const body = request.method === "POST" ? await request.json() : null;
  traffic.push({ authorization, body });
  if (!account) return Response.json({ error: "invalid API key" }, { status: 401 });
  if (request.method === "GET") {
    return Response.json({ object: "list", data: [
      { id: model, object: "model", owned_by: "devin" },
      { id: `fixture-discovered-${account.name}`, object: "model", owned_by: "devin" },
    ] });
  }
  if (body.model !== model || body.stream !== account.stream) {
    return Response.json({ error: "unexpected completion request" }, { status: 400 });
  }

  const envelope = { id: `chatcmpl-${account.name}`, model, created: 1 };
  const message = { role: "assistant", content: `reply from ${account.name}` };
  const usage = {
    prompt_tokens: account.prompt,
    completion_tokens: account.completion,
    total_tokens: account.prompt + account.completion,
  };
  if (!body.stream) {
    return Response.json({
      ...envelope, object: "chat.completion", usage,
      choices: [{ index: 0, message, finish_reason: "stop" }],
    });
  }
  const chunk = { ...envelope, object: "chat.completion.chunk" };
  const frames = [
    { ...chunk, choices: [{ index: 0, delta: message, finish_reason: null }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { ...chunk, choices: [], usage },
  ];
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

function gatewayRequest(endpoint, { key, connectionId, body } = {}) {
  const headers = new Headers();
  if (key) headers.set("authorization", `Bearer ${key}`);
  if (connectionId) headers.set("x-connection-id", connectionId);
  if (body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${endpoint}`, {
    headers, method: body ? "POST" : "GET", body: body && JSON.stringify(body),
  });
}

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-devin-proxy-"));
  vi.stubEnv("HOME", directory);
  vi.stubEnv("DATA_DIR", path.join(directory, "data"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("DURINDOOR_PG_URL", undefined);
  vi.stubGlobal("fetch", proxyFixture);
  const transport = await import("open-sse/utils/proxyFetch.js");
  restoreFetch = transport.__setOriginalFetchForTesting(proxyFixture);
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  await (await import("@/lib/db/repos/settingsRepo.js")).updateSettings({
    requireApiKey: true, enableProxyTimeline: false,
    // Keep the public catalog from probing unrelated keyless providers.
    disabledFreeProviders: ["aihorde", "opencode"],
  });
});

afterAll(async () => {
  try {
    await disposeLoadedRequestDetailsRepo();
    await adapter?.close?.();
  } finally {
    restoreFetch?.();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

it("discovers, routes and accounts for delegated Devin inference by connection", async () => {
  const { POST: createNode } = await import("@/app/api/provider-nodes/route.js");
  const { POST: createConnection } = await import("@/app/api/providers/route.js");
  const { GET: discoverModels } = await import("@/app/api/providers/[id]/models/route.js");
  const { POST: saveModel } = await import("@/app/api/models/custom/route.js");
  const { GET: listModels } = await import("@/app/api/v1/models/route.js");
  const { POST: chat } = await import("@/app/api/v1/chat/completions/route.js");
  const { createApiKey, getApiKeyUsageTotals } = await import("@/lib/db/index.js");

  const created = await createNode(gatewayRequest("/api/provider-nodes", {
    body: { name: "Devin proxy fixture", prefix, apiType: "chat", baseUrl: `${proxyOrigin}/v1` },
  }));
  expect(created.status).toBe(201);
  const { node } = await created.json();

  const connections = [];
  for (const account of accounts) {
    const saved = await createConnection(gatewayRequest("/api/providers", {
      body: { provider: node.id, name: account.name, apiKey: account.proxyKey },
    }));
    expect(saved.status).toBe(201);
    const { connection } = await saved.json();
    const client = await createApiKey(account.name, "fixture-machine", [], null, null, {
      providerConnectionIds: [connection.id],
    });
    connections.push({ ...account, connection, client });
    const endpoint = `/api/providers/${connection.id}/models`;
    const discovery = await discoverModels(gatewayRequest(endpoint), { params: { id: connection.id } });
    expect(discovery.status).toBe(200);
    const { models } = await discovery.json();
    expect(models.map(({ id }) => id)).toEqual([model, `fixture-discovered-${account.name}`]);
    expect(traffic.at(-1)).toEqual({ authorization: `Bearer ${account.proxyKey}`, body: null });
  }

  const savedModel = await saveModel(gatewayRequest("/api/models/custom", {
    body: { providerAlias: prefix, id: model },
  }));
  expect(savedModel.ok).toBe(true);
  for (const { client } of connections) {
    const catalog = await listModels(gatewayRequest("/v1/models", { key: client.key }));
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).data).toContainEqual(expect.objectContaining({
      id: `${prefix}/${model}`, object: "model",
    }));
  }

  const messages = [{ role: "user", content: "fixture prompt" }];
  const completion = (account, key, connectionId = account.connection.id) => chat(gatewayRequest("/v1/chat/completions", {
    key, connectionId, body: { model: `${prefix}/${model}`, messages, stream: account.stream },
  }));
  const [alpha, beta] = connections;
  const beforeChat = traffic.length;
  expect((await completion(alpha)).status).toBe(401);
  expect((await completion(alpha, alpha.proxyKey)).status).toBe(401);
  expect((await completion(alpha, alpha.client.key, beta.connection.id)).status).toBe(400);
  expect((await completion(beta, beta.client.key, alpha.connection.id)).status).toBe(400);
  expect(traffic).toHaveLength(beforeChat);

  await Promise.all(connections.map(async (account) => {
    const response = await completion(account, account.client.key);
    expect(response.status).toBe(200);
    if (account.stream) {
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const frames = (await response.text()).split("\n").filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));
      expect(frames.pop()).toBe("[DONE]");
      const chunks = frames.map((frame) => JSON.parse(frame));
      expect(chunks.flatMap(({ choices }) => choices).map(({ delta }) => delta?.content || "").join(""))
        .toBe(`reply from ${account.name}`);
    } else {
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({
        object: "chat.completion",
        choices: [{ message: { content: `reply from ${account.name}` }, finish_reason: "stop" }],
      });
    }
  }));

  await vi.waitFor(async () => {
    for (const account of connections) {
      expect(await getApiKeyUsageTotals(account.client.id)).toMatchObject({
        totalTokens: account.prompt + account.completion, totalRequests: 1,
      });
    }
    const rows = adapter.all("SELECT connectionId, model, promptTokens, completionTokens FROM usageHistory");
    expect(rows).toHaveLength(connections.length);
    expect(rows).toEqual(
      expect.arrayContaining(connections.map((account) => ({
        connectionId: account.connection.id, model, promptTokens: account.prompt, completionTokens: account.completion,
      }))),
    );
  });
  const requests = traffic.filter(({ body }) => body);
  expect(requests).toHaveLength(connections.length);
  for (const account of connections) {
    expect(requests).toContainEqual({
      authorization: `Bearer ${account.proxyKey}`,
      body: expect.objectContaining({ model, messages, stream: account.stream }),
    });
  }
  expect(unexpected).toEqual([]);
});
