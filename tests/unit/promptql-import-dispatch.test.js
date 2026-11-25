import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  finishPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const AUTH = "https://auth.pro.ql.app/ddn/project/token";
const GQL = "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
const cookie = (name) => `__Host-next-auth.csrf-token=synthetic-csrf; next-auth.session-token=synthetic-${name}`;
const project = (name) => `project-${name}`;
const jwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic-signature`;
const token = (name) => jwt({
  iss: "enrich-token",
  exp: 4_102_444_800,
  "https://promptql.hasura.io": { "x-hasura-project-id": project(name) },
});

let root;
let routes;
let db;
let issuePairing;
let fetchMock;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "promptql-import-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  delete global._dbAdapter;
  vi.resetModules();
  fetchMock = vi.fn(async () => { throw new Error("Unexpected fetch"); });
  vi.stubGlobal("fetch", fetchMock);
  db = await import("../../src/lib/localDb.js");
  ({ issuePairing } = await import("../../src/lib/providers/cookieImport/pairing.js"));
  routes = {
    importCookies: await import("../../src/app/api/providers/cookie-import/route.js"),
    validate: await import("../../src/app/api/providers/[id]/test/route.js"),
    openai: await import("../../src/app/api/v1/chat/completions/route.js"),
    anthropic: await import("../../src/app/api/v1/messages/route.js"),
  };
  vi.stubGlobal("fetch", fetchMock);
}, 60_000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function request(endpoint, body, headers) {
  return new Request(`https://dashboard.invalid${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function importSession(name, connectionId) {
  const provider = "promptql";
  const target = connectionId ? { action: "update", connectionId } : { action: "create", name };
  const pairing = issuePairing({ provider, owner: "synthetic-owner", target });
  const response = await routes.importCookies.POST(request("/api/providers/cookie-import", {
    provider,
    ...(connectionId ? { connectionId } : null),
    origin: "https://prompt.ql.app",
    cookies: [
      { name: "__Host-next-auth.csrf-token", value: "synthetic-csrf" },
      { name: "next-auth.session-token", value: `synthetic-${name}` },
    ],
  }, { "x-durindoor-pairing-token": pairing.token }));
  expect(response.status).toBe(connectionId ? 200 : 201);
  const { connection } = await response.json();
  const stored = await db.getProviderConnectionById(connection.id);
  expect(stored.apiKey).toBe(cookie(name));
  if (!connectionId) {
    expect(stored.accessToken).toBeFalsy();
    expect(stored.providerSpecificData?.projectId).toBeUndefined();
  }
  return connection.id;
}

async function validate(id) {
  const endpoint = `/api/providers/${id}/test`;
  return routes.validate.POST(request(endpoint, {}), { params: { id } });
}

function chat(id, format, stream) {
  const endpoint = format === "openai" ? "/v1/chat/completions" : "/v1/messages";
  return routes[format].POST(request(endpoint, {
    model: "promptql/gemini-3.7-flash",
    messages: [{ role: "user", content: "ping" }],
    ...(format === "anthropic" ? { max_tokens: 64 } : null),
    stream,
  }, { "x-connection-id": id }));
}

function mockPlayground(names, { authStatus = 200, gqlStatus = 200 } = {}) {
  const tokens = new Map(names.map((name) => [name, token(name)]));
  return fetchMock.mockImplementation(async (url, init) => {
    // Chat runs under quota dispatch, so the message send refuses redirects outright.
    const sendsMessage = String(init.body).includes('"operationName":"StartThreadRoomless"');
    expect(init.redirect).toBe(sendsMessage ? "error" : "manual");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    if (url === AUTH) {
      const name = names.find((candidate) => headers.get("cookie") === cookie(candidate));
      expect(name).toBeDefined();
      expect(headers.has("authorization")).toBe(false);
      if (authStatus !== 200) return new Response(null, { status: authStatus, headers: { location: "https://redirect.invalid/" } });
      return Response.json({ token: tokens.get(name) });
    }
    expect(url).toBe(GQL);
    expect(headers.has("cookie")).toBe(false);
    const name = names.find((candidate) => headers.get("authorization") === `Bearer ${tokens.get(candidate)}`);
    expect(name).toBeDefined();
    if (gqlStatus !== 200) return new Response(null, { status: gqlStatus, headers: { location: "https://redirect.invalid/" } });
    const { operationName, variables } = JSON.parse(init.body);
    if (operationName === "FetchLlmConfigs") return Response.json({ data: { llm_config: [] } });
    if (operationName === "StartThreadRoomless") {
      expect(variables.projectId).toBe(project(name));
      return Response.json({ data: { start_thread: { thread_id: `thread-${name}`, thread_events: [] } } });
    }
    expect(operationName).toBe("QueryThreadEvents");
    expect(variables.thread_id).toBe(`thread-${name}`);
    return Response.json({ data: { thread_events: [{
      thread_event_id: 1,
      event_data: { type: "AgentMessage", content: `pong from ${name}`, final_response_sent: true },
    }] } });
  });
}

it.each([
  ["openai", false], ["openai", true], ["anthropic", false], ["anthropic", true],
])("validates a cookie import and dispatches %s with stream=%s", async (format, stream) => {
  const upstream = mockPlayground(["alice"]);
  const id = await importSession("alice");
  expect(await (await validate(id)).json()).toMatchObject({ valid: true });

  const result = await chat(id, format, stream);
  expect(result.status).toBe(200);
  if (stream) {
    expect(result.headers.get("content-type")).toContain("text/event-stream");
    const body = await result.text();
    expect(body).toContain("pong from alice");
    expect(body).toContain(format === "openai" ? "data: [DONE]" : "event: message_stop");
  } else {
    const body = await result.json();
    expect(format === "openai" ? body.choices[0].message.content : body.content[0].text).toBe("pong from alice");
  }

  const stored = await db.getProviderConnectionById(id);
  expect(stored.apiKey).toBe(cookie("alice"));
  expect(stored.accessToken).toBe(token("alice"));
  expect(stored.providerSpecificData.promptqlSessionProjectId).toBe(project("alice"));
  expect(upstream.mock.calls.filter(([url]) => url === AUTH)).toHaveLength(2);
});

it("persists each imported project's credentials on its own connection and reuses the saved token", async () => {
  const upstream = mockPlayground(["alice", "bob"]);
  const ids = [await importSession("alice"), await importSession("bob")];
  for (const index of [0, 1, 0]) {
    const name = ["alice", "bob"][index];
    const result = await chat(ids[index], "openai", false);
    expect(result.status).toBe(200);
    expect((await result.json()).choices[0].message.content).toBe(`pong from ${name}`);
    expect(await db.getProviderConnectionById(ids[index])).toMatchObject({
      apiKey: cookie(name),
      accessToken: token(name),
      providerSpecificData: { promptqlSessionProjectId: project(name) },
    });
  }
  expect(upstream.mock.calls.filter(([url]) => url === AUTH)).toHaveLength(2);
});

it("ignores a previous token after the connection imports a different cookie", async () => {
  const upstream = mockPlayground(["alice", "bob"]);
  const id = await importSession("alice");
  expect((await chat(id, "openai", false)).status).toBe(200);
  await importSession("bob", id);
  const result = await chat(id, "openai", false);
  expect(result.status).toBe(200);
  expect((await result.json()).choices[0].message.content).toBe("pong from bob");
  expect((await db.getProviderConnectionById(id)).accessToken).toBe(token("bob"));
  expect(upstream.mock.calls.filter(([url]) => url === AUTH)).toHaveLength(2);
});

it.each([401, 302])("reports exchange HTTP %i as a credential error and stops before GraphQL", async (authStatus) => {
  const upstream = mockPlayground(["alice"], { authStatus });
  const id = await importSession("alice");
  expect(await (await validate(id)).json()).toMatchObject({ valid: false, error: expect.stringMatching(/session/i) });
  expect((await chat(id, "openai", false)).status).toBe(401);
  expect(upstream.mock.calls.map(([url]) => url)).toEqual([AUTH, AUTH]);
  expect((await db.getProviderConnectionById(id)).accessToken).toBeFalsy();
});

it("treats a GraphQL catalog redirect as a credential error without retrying another operation", async () => {
  const upstream = mockPlayground(["alice"], { gqlStatus: 307 });
  const id = await importSession("alice");
  expect((await chat(id, "anthropic", false)).status).toBe(401);
  expect(upstream.mock.calls.map(([url]) => url)).toEqual([AUTH, GQL]);
  expect((await db.getProviderConnectionById(id)).accessToken).toBeFalsy();
});

it("rejects a successful exchange that only returns a DDN project token", async () => {
  const id = await importSession("alice");
  fetchMock.mockImplementation(async (url, init) => {
    expect(url).toBe(AUTH);
    expect(init.redirect).toBe("manual");
    return Response.json({ token: jwt({ iss: "https://auth.pro.hasura.io/ddn/token", aud: "00000000-0000-4000-8000-000000000001" }) });
  });
  expect(await (await validate(id)).json()).toMatchObject({ valid: false, error: expect.stringMatching(/session/i) });
  expect((await chat(id, "openai", false)).status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("rejects missing credentials before sending an upstream request", async () => {
  const { PromptQlExecutor } = await import("../../open-sse/executors/promptql.js");
  const result = await new PromptQlExecutor().execute({ credentials: {}, body: {} });
  expect(result.response.status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});
