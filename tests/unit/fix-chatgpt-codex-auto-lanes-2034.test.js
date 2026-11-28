/** #2034: real import, public handlers and executor; synthetic network/browser boundary.
 * Does not establish real UI selection, sign-in or live provider availability.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../translator/registerAll.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-codex-machine-id" }));
// Only who counts as an operator is decided here. The origin checks stay real.
vi.mock("@/dashboardGuard", async (importOriginal) => {
  const operator = async (request) => request.headers.get("x-9r-cli-token") === "synthetic-operator";
  return { ...(await importOriginal()), canAccessManagementApi: operator, isOperatorRequest: operator, canManageAccessConfig: operator };
});

const ID = "chatgpt-web-codex";
const ORIGIN = "https://chatgpt.com";
const SESSION = "__Secure-next-auth.session-token";
const SESSION_URL = `${ORIGIN}/api/auth/session`;
const CONVERSATION_URL = `${ORIGIN}/backend-api/f/conversation`;
const DASHBOARD = "https://dashboard.example";
// Synthetic only. `tag` marks the account so a crossed credential is visible.
const chunk = (tag, index) => `synthetic-codex-${tag}-chunk-${index}`;
const header = (tag) => `${SESSION}.0=${chunk(tag, 0)}; ${SESSION}.1=${chunk(tag, 1)}`;
const accessToken = (tag) => `synthetic-access-token-${tag}`;
const SECRET_PATTERN = /synthetic-codex-\w+-chunk|synthetic-unapproved|synthetic-access-token|ddpair_/;

let root;
let db;
let routes;
let pairingStore;
let tlsModule;
let executor;
let originalDeps;
let logs;
let outbound;
let tlsCalls;
let usageWrite;

const consoleText = () => logs.flatMap((spy) => spy.mock.calls)
  .map((call) => call.map((part) => (part instanceof Error ? part.stack : JSON.stringify(part) ?? String(part))).join(" "))
  .join("\n");

function dashboardRequest(url, body, { method = "POST", headers = {} } = {}) {
  return new NextRequest(`${DASHBOARD}${url}`, {
    method,
    headers: { "content-type": "application/json", host: "dashboard.example", origin: DASHBOARD, "x-9r-cli-token": "synthetic-operator", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}
const params = (id) => ({ params: Promise.resolve({ id }) });

const requestPairing = (body, options) => routes.pairing.POST(dashboardRequest("/api/providers/cookie-import/pairing", body, options));

async function mintPairing(target, provider = ID) {
  const res = await requestPairing({ provider, ...target });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).pairing;
}

/** The import request carries the pairing secret only: no operator header, extension origin. */
function submit(token, body) {
  const headers = { "content-type": "application/json", host: "dashboard.example", origin: "chrome-extension://synthetic" };
  if (token) headers["x-durindoor-pairing-token"] = token;
  return routes.import.POST(new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, { method: "POST", headers, body: JSON.stringify(body) }));
}

const serverCookies = (tag, extra = {}) => [1, 0].map((index) => ({ name: `${SESSION}.${index}`, value: chunk(tag, index), ...extra }));

/** Pair and import the way the dashboard dialog does. */
async function importAccount(tag, target = { action: "create", name: `codex-${tag}` }) {
  const pairing = await mintPairing(target);
  const { name, connectionId } = target;
  const res = await submit(pairing.token, {
    provider: ID, origin: ORIGIN, cookies: serverCookies(tag),
    ...(target.action === "create" ? { name } : { connectionId }),
  });
  expect(res.status, await res.clone().text()).toBe(target.action === "create" ? 201 : 200);
  return (await res.json()).connection.id;
}

async function edit(id, body) {
  const res = await routes.provider.PUT(dashboardRequest(`/api/providers/${id}`, body, { method: "PUT" }), params(id));
  expect(res.status, await res.clone().text()).toBe(200);
}

const assignProxy = (id, tag, providerSpecificData) => edit(id, {
  connectionProxyEnabled: true, connectionProxyUrl: `http://proxy-${tag}.invalid:8080`,
  ...(providerSpecificData ? { providerSpecificData } : null),
});

const rows = () => db.getProviderConnections({});
/** A chatgpt.com stand-in at the TLS client seam. The reply follows the cookie it is sent. */
function scriptTls({ rotate = {}, expired = [] } = {}) {
  tlsModule.__setTlsFetchOverrideForTesting(async (url, options) => {
    const cookie = options.headers?.Cookie ?? "";
    const tag = /synthetic-codex-(\w+)-chunk/.exec(cookie)?.[1];
    tlsCalls.push({
      url: String(url), cookie, tag, proxyUrl: options.proxyUrl, guarded: options.sameOriginRedirects,
      authorization: options.headers?.Authorization, body: options.body,
    });
    const reply = (body, extra = {}) => ({ status: 200, headers: new Headers({ "Content-Type": "application/json", ...extra }), body: null, text: JSON.stringify(body) });
    if (String(url) === SESSION_URL) {
      if (expired.includes(tag)) return reply({});
      return reply({ accessToken: accessToken(tag), user: { id: `user-${tag}` } }, rotate[tag] ? { "set-cookie": rotate[tag] } : {});
    }
    if (String(url).includes("/sentinel/chat-requirements")) return reply({ token: "requirements", proofofwork: { required: false } });
    if (String(url) === CONVERSATION_URL) {
      const message = { conversation_id: "conversation", message: { id: "reply", author: { role: "assistant" }, content: { content_type: "text", parts: [`pong-${tag}`] }, status: "finished_successfully", end_turn: true } };
      return { status: 200, headers: new Headers({ "Content-Type": "text/event-stream" }), body: null, text: `data: ${JSON.stringify(message)}\n\ndata: [DONE]\n\n` };
    }
    return reply({});
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cookie-flow-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  outbound = vi.fn(async () => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);
  tlsCalls = [];
  db = await import("@/lib/db/index.js");
  usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  pairingStore = await import("@/lib/providers/cookieImport/pairing.js");
  pairingStore.clearPairings();
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
  };
  tlsModule = await import("../../open-sse/services/chatgptTlsClient.js");
  const { __resetChatGptWebCachesForTesting } = await import("../../open-sse/executors/chatgpt-web-http.js");
  __resetChatGptWebCachesForTesting();
  scriptTls();
  executor = (await import("../../open-sse/executors/index.js")).getExecutor(ID);
  originalDeps = executor.deps;
  // A fresh database plus the route graph can pass the default hook limit on a loaded host.
}, 60_000);

afterEach(async () => {
  executor.deps = originalDeps;
  tlsModule.__setTlsFetchOverrideForTesting(null);
  pairingStore.clearPairings();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

const LANES = [
  ["luna", { kind: "free", thinkEnabled: false }, "auto"],
  ["think", { kind: "free", thinkEnabled: true }, "auto"],
  ["instant", { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 0 }, "gpt-5-6"],
  ["medium", { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 1 }, "gpt-5-6-thinking", "standard"],
  ["high", { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 2 }, "gpt-5-6-thinking", "extended"],
  ["extra-high", { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 3 }, "gpt-5-6-thinking", "max"],
  ["pro", { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 4 }, "gpt-5-6-pro", "standard"],
];

function browserBoundary() {
  const createSession = vi.fn(async (input) => ({ input }));
  const runTurn = vi.fn(async (session) => ({ text: `browser-${session.input.connectionId}` }));
  executor.deps = { browser: { createSession, runTurn, readSessionCookies: async () => [] } };
  return { createSession, runTurn };
}

async function accounts(transport) {
  const alpha = await importAccount("alpha");
  const bravo = await importAccount("bravo");
  for (const [id, tag, priority] of [[alpha, "alpha", 1], [bravo, "bravo", 2]]) {
    await assignProxy(id, tag, transport ? { transport } : undefined);
    await edit(id, { priority });
  }
  expect((await db.getProviderConnectionById(alpha)).providerSpecificData.transport).toBe(transport);
  return { alpha, bravo };
}

async function publicChat(lane, format, stream) {
  const claude = format === "claude";
  const body = { model: `cgpt-codex/${lane}`, stream, messages: [{ role: "user", content: "hello" }],
    ...(claude ? { max_tokens: 32, thinking: { type: "disabled" } } : { reasoning_effort: "low" }) };
  const request = new Request(`http://gateway.invalid/v1/${claude ? "messages" : "chat/completions"}`, {
    method: "POST", headers: { "content-type": "application/json", ...(claude ? { "anthropic-version": "2023-06-01" } : {}) }, body: JSON.stringify(body),
  });
  const response = claude
    ? await (await import("../../src/sse/handlers/chat/keepalive.js")).handleMessages(request)
    : await routes.handleChat(request);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  if (stream) expect(text).toContain(claude ? "message_stop" : "[DONE]");
  else if (claude) expect(JSON.parse(text).content[0].type).toBe("text");
  else expect(JSON.parse(text).choices[0].message.role).toBe("assistant");
  await Promise.all(usageWrite.mock.results.map((result) => result.value));
  return text;
}

function assertHttp(start, tag, slug, effort, lane) {
  const calls = tlsCalls.slice(start);
  const sends = calls.filter((call) => call.url === CONVERSATION_URL);
  expect(sends).toHaveLength(1);
  for (const call of calls) {
    expect(call).toMatchObject({ cookie: header(tag), proxyUrl: `http://proxy-${tag}.invalid:8080`, guarded: true });
    if (call.authorization) expect(call.authorization).toBe(`Bearer ${accessToken(tag)}`);
  }
  const body = JSON.parse(sends[0].body);
  expect(body.model).toBe(slug);
  expect(body.thinking_effort).toBe(effort);
  expect(body.system_hints ?? []).toEqual(lane === "think" ? ["reason"] : []);
}

// All seven scenarios, both public formats, buffered and streamed, both accounts.
describe.each([undefined, "auto", "browser", "http"])("imported transport %s", (transport) => {
  it.each([ ["openai", false], ["openai", true], ["claude", false], ["claude", true] ])("binds every lane for %s stream=%s without replay", async (format, stream) => {
    const { alpha, bravo } = await accounts(transport);
    const boundary = browserBoundary();
    for (const [id, tag] of [[alpha, "alpha"], [bravo, "bravo"]]) {
      if (tag === "bravo") await edit(alpha, { isActive: false });
      for (const [lane, selection, slug, effort] of LANES) {
        const start = tlsCalls.length;
        const turns = boundary.runTurn.mock.calls.length;
        const text = await publicChat(lane, format, stream);
        if (transport === "http") {
          expect(text).toContain(`pong-${tag}`);
          assertHttp(start, tag, slug, effort, lane);
          expect(boundary.createSession).not.toHaveBeenCalled();
        } else {
          expect(text).toContain(`browser-${id}`);
          expect(boundary.runTurn.mock.calls.length).toBe(turns + 1);
          const input = boundary.createSession.mock.calls.at(-1)[0];
          expect(input).toMatchObject({ connectionId: id, proxyUrl: `http://proxy-${tag}.invalid:8080`, sameOriginRedirects: true, selection });
          expect(input.storageState.cookies.map(({ name, value }) => `${name}=${value}`).join("; ")).toBe(header(tag));
          expect(tlsCalls).toEqual([]);
        }
        expect((await db.getProviderConnectionById(id)).apiKey).toBe(header(tag));
      }
    }
    expect(outbound).not.toHaveBeenCalled();
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  }, 60_000);
});

async function executeImported(id, lane, overrides = {}) {
  const connection = await db.getProviderConnectionById(id);
  return executor.execute({
    model: lane, body: { messages: [{ role: "user", content: "hello" }] }, stream: false,
    credentials: { ...connection, connectionId: id },
    proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-alpha.invalid:8080" },
    ...overrides,
  });
}

it("refuses unknown names before any browser or HTTP dispatch in auto and browser modes", async () => {
  const { alpha } = await accounts();
  const boundary = browserBoundary();
  for (const transport of ["auto", "browser"]) {
    await assignProxy(alpha, "alpha", { transport });
    const result = await executeImported(alpha, "unsupported-lane");
    expect(result.response.status).toBe(400);
    expect(await result.response.text()).not.toMatch(SECRET_PATTERN);
  }
  expect(boundary.createSession).not.toHaveBeenCalled();
  expect(boundary.runTurn).not.toHaveBeenCalled();
  expect(tlsCalls).toEqual([]);
});

it("uses HTTP for tools in auto; explicit browser refuses tools before dispatch", async () => {
  const { alpha } = await accounts();
  const boundary = browserBoundary();
  const body = { messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "weather", parameters: { type: "object", properties: {} } } }] };
  const result = await executeImported(alpha, "high", { body });
  expect(result.response.status).toBe(200);
  await result.response.text();
  assertHttp(0, "alpha", "gpt-5-6-thinking", "extended", "high");
  expect(boundary.createSession).not.toHaveBeenCalled();
  const count = tlsCalls.length;
  await assignProxy(alpha, "alpha", { transport: "browser" });
  const refused = await executeImported(alpha, "high", { body });
  expect(refused.response.status).toBe(400);
  expect(tlsCalls).toHaveLength(count);
  expect(boundary.runTurn).not.toHaveBeenCalled();
});

it("cancels before dispatch and never replays an accepted or unknown browser turn on HTTP", async () => {
  const { alpha } = await accounts();
  const boundary = browserBoundary();
  const controller = new AbortController();
  controller.abort();
  await expect(executeImported(alpha, "high", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(boundary.createSession).not.toHaveBeenCalled();
  const { BrowserUnavailableError } = await import("../../open-sse/services/browserPool.js");
  for (const error of [new Error("synthetic unknown turn outcome"), new Error("synthetic accepted turn failed"), new BrowserUnavailableError("synthetic turn unavailable")]) {
    boundary.runTurn.mockRejectedValueOnce(error);
    const result = await executeImported(alpha, "high");
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    await result.response.text();
  }
  expect(boundary.runTurn).toHaveBeenCalledTimes(3);
  expect(tlsCalls).toEqual([]);
  expect(outbound).not.toHaveBeenCalled();
});

it("falls back only when session startup is unavailable, never for explicit browser", async () => {
  const { alpha } = await accounts();
  const { BrowserUnavailableError } = await import("../../open-sse/services/browserPool.js");
  const boundary = browserBoundary();
  boundary.createSession.mockRejectedValue(new BrowserUnavailableError("synthetic unavailable"));
  const result = await executeImported(alpha, "high");
  expect(result.response.status).toBe(200);
  await result.response.text();
  assertHttp(0, "alpha", "gpt-5-6-thinking", "extended", "high");
  const count = tlsCalls.length;
  await assignProxy(alpha, "alpha", { transport: "browser" });
  const refused = await executeImported(alpha, "high");
  expect(refused.response.status).toBe(503);
  expect(tlsCalls).toHaveLength(count);
  expect(boundary.runTurn).not.toHaveBeenCalled();
});

it("passes cancellation to the dispatched turn and does not replay it", async () => {
  const { alpha } = await accounts();
  const boundary = browserBoundary();
  const controller = new AbortController();
  boundary.runTurn.mockImplementationOnce(async (_session, turn) => {
    expect(turn.signal).toBe(controller.signal);
    controller.abort();
    throw new DOMException("synthetic cancelled", "AbortError");
  });
  const result = await executeImported(alpha, "high", { signal: controller.signal });
  expect(result.response.status).toBeGreaterThanOrEqual(400);
  expect(boundary.runTurn).toHaveBeenCalledOnce();
  expect(tlsCalls).toEqual([]);
  expect(outbound).not.toHaveBeenCalled();
});

it.each(["auto", "browser"])("public routes refuse an unsupported model on %s before dispatch", async (transport) => {
  await accounts(transport);
  const boundary = browserBoundary();
  for (const endpoint of ["chat/completions", "messages"]) {
    const request = new Request(`http://gateway.invalid/v1/${endpoint}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "cgpt-codex/unsupported-lane", max_tokens: 32, messages: [{ role: "user", content: "hello" }] }),
    });
    const response = endpoint === "messages"
      ? await (await import("../../src/sse/handlers/chat/keepalive.js")).handleMessages(request)
      : await routes.handleChat(request);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toMatch(SECRET_PATTERN);
  }
  expect(boundary.createSession).not.toHaveBeenCalled();
  expect(boundary.runTurn).not.toHaveBeenCalled();
  expect(tlsCalls).toEqual([]);
  expect(outbound).not.toHaveBeenCalled();
});
