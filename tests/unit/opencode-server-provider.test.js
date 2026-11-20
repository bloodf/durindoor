import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/dashboardGuard", async (importOriginal) => ({
  ...await importOriginal(),
  isOperatorRequest: async (request) => request.headers.get("x-test-operator") === "yes",
}));

const provider = "opencode-server";
const model = "fixture/model/one";
const generatePath = "/api/experimental/generate/text";
const calls = [];

async function startServer(name) {
  const apiKey = `fixture:${name}`;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const call = { name, method: request.method, path: request.url, auth: request.headers.authorization, raw };
    calls.push(call);
    const reply = (status, data) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (call.auth !== `Basic ${Buffer.from(apiKey).toString("base64")}`) return reply(401, {});
    if (call.method === "GET" && call.path === "/api/model") {
      return reply(200, {
        location: { directory: "/fixture" },
        data: [
          { id: "model/one", modelID: "vendor-id", providerID: "fixture", name, enabled: true,
            type: "chat", capabilities: {}, variants: [], time: { released: 0 }, cost: [],
            status: "active", limit: { context: 4096, output: 1024 } },
          { id: "disabled", providerID: "fixture", enabled: false },
          { id: "image", providerID: "fixture", type: "image", enabled: true },
        ],
      });
    }
    if (call.method !== "POST" || call.path !== generatePath || name === "old") return reply(404, {});
    if (JSON.parse(raw).prompt === "bad model") {
      return reply(400, { error: { message: "Unknown parameter: 'model'." } });
    }
    return reply(200, { data: { text: `response from ${name}` } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    connection: { id: name, apiKey, provider, authType: "apikey",
      providerSpecificData: { baseUrl: `http://127.0.0.1:${server.address().port}` } },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

let servers;
let routes;
let dataDir;
const operatorHeaders = { "Content-Type": "application/json", "x-test-operator": "yes" };

function jsonRequest(path, body, headers = operatorHeaders) {
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "durindoor-opencode-test-"));
  vi.stubEnv("DATA_DIR", dataDir);
  servers = await Promise.all(["first", "second", "old"].map(startServer));
  const allowed = new Set(servers.map(({ connection }) => connection.providerSpecificData.baseUrl));
  const fetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    if (!allowed.has(new URL(url).origin)) throw new Error("Unexpected network request");
    return fetch(url, init);
  });
  const [validate, create, catalog, models, chat, responses, update, providers, health] = await Promise.all([
    import("../../src/app/api/providers/validate/route.js"),
    import("../../src/app/api/providers/route.js"),
    import("../../src/app/api/providers/[id]/models/route.js"),
    import("../../src/app/api/v1/models/route.js"),
    import("../../src/app/api/v1/chat/completions/route.js"),
    import("../../src/app/api/v1/responses/route.js"),
    import("../../src/app/api/providers/[id]/route.js"),
    import("../../src/lib/providerRouteHandlers.js"),
    import("../../src/lib/providerHealthProbe.js"),
  ]);
  routes = { validate: validate.POST, create: create.POST, catalog: catalog.GET,
    models: models.GET, chat: chat.POST, responses: responses.POST, update: update.PUT,
    providers: providers.GET, health: health.probeConnectionHealth };
  for (const server of servers) {
    const { connection } = server;
    const result = await routes.create(jsonRequest("/api/providers", { ...connection, name: connection.id }));
    expect(result.status, JSON.stringify(await result.clone().json())).toBe(201);
    connection.savedId = (await result.json()).connection.id;
  }
}, 30_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers?.map(({ close }) => close()) || []);
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function chat(connection, fields = {}, responses = false) {
  const body = { model: `ocs/${model}`, ...(responses ? { input: "hello" } : { messages: [{ role: "user", content: "hello" }] }), ...fields };
  const endpoint = responses ? "/v1/responses" : "/v1/chat/completions";
  const response = await (responses ? routes.responses : routes.chat)(jsonRequest(endpoint, body, {
    "Content-Type": "application/json",
    "x-connection-id": connection.savedId,
    "x-durindoor-token-saver": "off",
  }));
  return { response };
}

describe("operator-managed OpenCode Server", () => {
  it("validates the saved Basic credential and discovers only enabled chat models per connection", async () => {
    const [first, second] = servers.map(({ connection }) => connection);
    const result = await routes.validate(jsonRequest("/api/providers/validate", first));
    expect(await result.json()).toEqual({ valid: true, error: null });
    const denied = await routes.validate(jsonRequest("/api/providers/validate", first, {}));
    expect(denied.status).toBe(403);
    const listing = await routes.providers(new Request("http://localhost/api/providers"));
    expect((await listing.json()).connections.find(({ id }) => id === first.savedId)?.canDiscoverModels).toBe(true);
    const catalogs = await Promise.all([first, second].map(async ({ savedId: id }) =>
      (await routes.catalog(new Request(`http://localhost/api/providers/${id}/models`), { params: { id } })).json()));
    expect(catalogs.map(({ models }) => models.map(({ id, name }) => ({ id, name })))).toEqual([
      [{ id: model, name: "first" }], [{ id: model, name: "second" }],
    ]);
    const list = await routes.models(new Request("http://localhost/v1/models"));
    expect((await list.json()).data).toContainEqual(expect.objectContaining({ id: `ocs/${model}` }));
    expect(await routes.health(first)).toEqual({ valid: true, status: 200, error: null });
    const wrong = await routes.validate(jsonRequest("/api/providers/validate", { ...first, apiKey: second.apiKey }));
    expect(await wrong.json()).toMatchObject({ valid: false, error: expect.stringContaining("401") });

  });

  it("sends exactly the documented model reference and prompt and scopes inference to the connection", async () => {
    const results = await Promise.all(servers.slice(0, 2).map(({ connection }) => chat(connection)));
    for (const [index, { response }] of results.entries()) {
      expect(response.status).toBe(200);
      const completion = await response.json();
      expect(completion.choices[0].message.content).toBe(`response from ${servers[index].connection.id}`);
      expect(completion.usage).toBeUndefined();
    }
    const sent = calls.filter(({ method }) => method === "POST");
    expect(sent).toHaveLength(2);
    for (const call of sent) {
      expect(call.path).toBe(generatePath);
      expect(JSON.parse(call.raw)).toEqual({ model: { providerID: "fixture", id: "model/one" }, prompt: "hello" });
      expect(call.auth).toBe(`Basic ${Buffer.from(`fixture:${call.name}`).toString("base64")}`);
    }
  });

  it("wraps the completed JSON in downstream SSE and translates Responses input", async () => {
    const { connection } = servers[0];
    const { response } = await chat(connection, { stream: true });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await response.text();
    expect(events).toContain("response from first");
    expect(events).toContain("data: [DONE]");
    const translated = await chat(connection, {}, true);
    expect(translated.response.status).toBe(200);
    expect(await translated.response.json()).toMatchObject({ object: "response" });
  });

  it("preserves 401 and reports an unavailable stateless endpoint without falling back", async () => {
    const [first, second, old] = servers.map(({ connection }) => connection);
    const wrong = await routes.create(jsonRequest("/api/providers", {
      ...first, name: "wrong-credential", apiKey: second.apiKey,
    }));
    expect(wrong.status).toBe(201);
    const unauthorized = await chat({ savedId: (await wrong.json()).connection.id });
    expect(unauthorized.response.status).toBe(401);
    const unavailable = await chat(old);
    expect(unavailable.response.status).toBe(404);
    expect(await unavailable.response.text()).toContain("generation endpoint or selected model is unavailable");
    expect(calls.every(({ path }) => [generatePath, "/api/model"].includes(path))).toBe(true);
  });


  it("preserves the selected model when upstream rejects the request", async () => {
    const start = calls.length;
    const { response } = await chat(servers[0].connection, {
      messages: [{ role: "user", content: "bad model" }],
    });
    expect(response.status).toBe(400);
    expect(calls.slice(start).map(({ raw }) => JSON.parse(raw))).toEqual([
      { model: { providerID: "fixture", id: "model/one" }, prompt: "bad model" },
    ]);
  });

  it("requires operator authority to configure or replace the credential destination", async () => {
    const { connection } = servers[0];
    const missing = await routes.create(jsonRequest("/api/providers", { provider, apiKey: connection.apiKey }));
    expect(missing.status).toBe(400);
    const denied = await routes.create(jsonRequest("/api/providers", connection, {}));
    expect(denied.status).toBe(403);
    const id = connection.savedId;
    const edit = (headers) => routes.update(new Request(`http://localhost/api/providers/${id}`, {
      method: "PUT", headers,
      body: JSON.stringify({ providerSpecificData: { baseUrl: "http://other.invalid" } }),
    }), { params: { id } });
    expect((await edit({})).status).toBe(403);
    const afterEdit = await chat(connection);
    expect((await afterEdit.response.json()).choices[0].message.content).toBe("response from first");
  });

  it.each([
    [{ tools: [{ type: "function", function: { name: "run" } }] }, false],
    [{ messages: [{ role: "tool", content: "output", tool_call_id: "call" }] }, false],
    [{ sessionID: "existing" }, false],
    [{ previous_response_id: "existing" }, true],
    [{ input: [{ type: "item_reference", id: "existing" }] }, true],
  ])("rejects unsupported features before any upstream traffic (%j)", async (fields, responses) => {
    const before = calls.length;
    const { response } = await chat(servers[0].connection, fields, responses);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(before);
  });
});
