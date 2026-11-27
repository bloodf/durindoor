// #2034 (1127): Inner.ai Web, Poe Web, Venice Web and v0 Web through the real registry,
// executor map, dashboard cookie import, connection store, model discovery, validation and
// the OpenAI and Anthropic chat routes. Closed mocks only: every upstream send is answered
// below, an unknown URL fails the test, and every cookie, token and email is synthetic.
// Passing here says nothing about the live services.
import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-registration-1127-"));
  process.env.DATA_DIR = dataDir;
  return { getAdapter: vi.fn(), getAdapterSync: vi.fn(() => { throw new Error("Fixture adapter is not initialized"); }), dataDir, originalDataDir };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: vi.fn(async () => true),
  isOperatorRequest: vi.fn(async () => true),
  hasExactRequestOrigin: vi.fn(() => true),
  isNonAdminApiKeyCaller: vi.fn(async () => false),
}));
// Only the adapter is a fixture: creation, lookup and encryption are the real repository.
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(async () => []), getProxyPoolById: vi.fn(), getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import { REGISTERED_EXECUTOR_IDS, getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { InnerAiWebExecutor } from "../../open-sse/executors/inner-ai-web.js";
import { PoeWebExecutor, POE_WEB_URL } from "../../open-sse/executors/poe-web.js";
import { VeniceWebExecutor } from "../../open-sse/executors/venice-web.js";
import { V0VercelWebExecutor, V0_CHAT_URL } from "../../open-sse/executors/v0-vercel-web.js";
import { INNER_AI_WEB_CHAT_URL, INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_PROFILE_URL } from "../../open-sse/providers/registry/inner-ai-web.js";
import { VENICE_WEB_CHAT_URL, VENICE_WEB_CLIENT_URL } from "../../open-sse/providers/registry/venice-web.js";
import { WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";
import { buildImportCandidates, filterCandidateCookies, parseCookieHeaderValue, parseCurlCommand, parseHarDocument } from "../../src/shared/utils/cookieImportParser.js";
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { probeRegistryProvider } from "../../src/lib/providerProbe.js";
import { isConversationProbeProvider } from "../../src/lib/providers/conversationProbe.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveRequestUsage } from "@/lib/usageDb.js";

const DASHBOARD = "https://dashboard.example";
const LEAK = "upstream-secret-detail";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims, signature = "synthetic-signature") => `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.${signature}`;
const future = () => Math.floor(Date.now() / 1000) + 3600;

// Two synthetic accounts per provider. The reply text names the account the upstream saw.
const INNER = { a: jwt({ device_id: "device-a", plan: "free", exp: future() }, "inner-a"), b: jwt({ device_id: "device-b", plan: "free", exp: future() }, "inner-b") };
const INNER_EMAIL = { [INNER.a]: "account-a@example.com", [INNER.b]: "account-b@example.com" };
const VENICE = { a: jwt({ id: "client_synthetic_a" }, "venice-a"), b: jwt({ id: "client_synthetic_b" }, "venice-b") };
const VENICE_SESSION = { [VENICE.a]: "sess_a", [VENICE.b]: "sess_b" };
const POE = { a: "synthetic-poe-a==", b: "synthetic-poe-b==" };
const V0 = { a: "synthetic-v0-a", b: "synthetic-v0-b" };
const accountOf = (table, value) => Object.entries(table).find(([, secret]) => secret === value)?.[0] ?? null;

const CASES = {
  "inner-ai-web": {
    executor: InnerAiWebExecutor, alias: "inaw", apiKeyTwin: "inner-ai", model: "gpt-4o",
    origin: "https://app.innerai.com", cookie: (account) => ({ name: "token", value: INNER[account], domain: ".innerai.com" }),
    stored: (account) => `token=${INNER[account]}`, chatUrl: INNER_AI_WEB_CHAT_URL,
  },
  "poe-web": {
    executor: PoeWebExecutor, alias: "poew", apiKeyTwin: "poe", model: "gpt-4o",
    origin: "https://www.poe.com", cookie: (account) => ({ name: "p-b", value: POE[account], domain: ".poe.com" }),
    stored: (account) => `p-b=${POE[account]}`, chatUrl: POE_WEB_URL,
  },
  "venice-web": {
    executor: VeniceWebExecutor, alias: "venw", apiKeyTwin: "venice", model: "venice-uncensored",
    origin: "https://clerk.venice.ai", cookie: (account) => ({ name: "__client", value: VENICE[account], domain: ".clerk.venice.ai" }),
    stored: (account) => `__client=${VENICE[account]}`, chatUrl: VENICE_WEB_CHAT_URL,
  },
  "v0-vercel-web": {
    executor: V0VercelWebExecutor, alias: null, apiKeyTwin: "v0-vercel", model: "v0-default",
    origin: "https://v0.dev", cookie: (account) => ({ name: "__vercel_session", value: V0[account], domain: ".v0.dev" }),
    stored: (account) => `__vercel_session=${V0[account]}`, chatUrl: V0_CHAT_URL,
  },
};
const IDS = Object.keys(CASES);

// ---- Closed upstream -------------------------------------------------------------------------
const wire = { calls: [], override: {}, minted: new Map(), followed: [] };
const sse = (body) => new Response(body, { headers: { "content-type": "text/event-stream" } });
const innerCatalog = (account) => [
  { id: `uuid-4o-${account}`, llm_model: "gpt-4o", ai_model_categories: [{ unique_identifier: "text" }] },
  { id: `uuid-only-${account}`, llm_model: `only-${account}`, ai_model_categories: [{ unique_identifier: "text" }] },
];
const reply = (account) => `reply for account ${account}`;

const routes = {
  [INNER_AI_WEB_PROFILE_URL]: (init) => {
    const email = INNER_EMAIL[init.headers["USER-TOKEN"]];
    return email ? Response.json({ data: { email } }) : new Response(LEAK, { status: 401 });
  },
  [INNER_AI_WEB_MODELS_URL]: (init) => {
    const account = accountOf(INNER, init.headers["USER-TOKEN"]);
    return account ? Response.json({ ai_models: innerCatalog(account) }) : new Response(LEAK, { status: 401 });
  },
  [INNER_AI_WEB_CHAT_URL]: (init) => {
    const account = accountOf(INNER, init.headers["USER-TOKEN"]);
    if (!account || init.headers["USER-EMAIL"] !== INNER_EMAIL[INNER[account]]) return new Response(LEAK, { status: 401 });
    return sse([{ type: "text", item: reply(account) }, { type: "end_stream", item: "end" }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  },
  [POE_WEB_URL]: (init) => {
    const account = accountOf(POE, init.headers.cookie?.replace(/^p-b=/, ""));
    return account ? Response.json({ data: { chatWithBot: { messageId: "m", text: reply(account), state: "complete" } } }) : new Response(LEAK, { status: 401 });
  },
  [VENICE_WEB_CLIENT_URL]: (init) => {
    const session = VENICE_SESSION[init.headers.Cookie?.replace(/^__client=/, "")];
    return session ? Response.json({ response: { sessions: [{ id: session, status: "active" }] } }) : new Response(LEAK, { status: 401 });
  },
  [VENICE_WEB_CHAT_URL]: (init) => {
    const account = wire.minted.get(String(init.headers.Authorization || "").replace(/^Bearer /, ""));
    if (!account) return new Response(LEAK, { status: 401 });
    return new Response(`${JSON.stringify({ kind: "content", content: reply(account) })}\n`, { headers: { "content-type": "text/html" } });
  },
  [V0_CHAT_URL]: (init) => {
    const account = accountOf(V0, init.headers.Cookie?.replace(/^__vercel_session=/, ""));
    if (!account) return new Response(LEAK, { status: 401 });
    if (JSON.parse(init.body).stream) {
      return sse(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: reply(account) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`);
    }
    return Response.json({ content: reply(account), usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
  },
};
const VENICE_MINT = /^https:\/\/clerk\.venice\.ai\/v1\/client\/sessions\/(sess_[ab])\/tokens$/;

const upstream = vi.fn(async (url, init = {}) => {
  const target = String(url);
  wire.calls.push({ url: target, init });
  let response;
  const mint = VENICE_MINT.exec(target);
  if (wire.override[target]) response = await wire.override[target](init);
  else if (mint) {
    const client = init.headers.Cookie?.replace(/^__client=/, "");
    if (VENICE_SESSION[client] !== mint[1]) response = new Response(LEAK, { status: 401 });
    else {
      const token = jwt({ sub: `user_${mint[1]}`, exp: future(), nonce: Math.random() });
      wire.minted.set(token, accountOf(VENICE, client));
      response = Response.json({ jwt: token });
    }
  } else if (routes[target]) response = await routes[target](init);
  else throw new Error(`unexpected mocked URL ${target}`);
  if (response.status >= 300 && response.status < 400 && init.redirect !== "manual") {
    if (init.redirect === "error") throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    wire.followed.push({ to: response.headers.get("location") });
  }
  return response;
});
const chatCalls = (id) => wire.calls.filter((call) => call.url === CASES[id].chatUrl);

let db;
let restoreOriginalFetch;
beforeEach(async () => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
  restoreOriginalFetch = __setOriginalFetchForTesting(upstream);
  vi.stubGlobal("fetch", upstream);
  Object.assign(wire, { calls: [], override: {}, followed: [] });
  clearPairings();
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  vi.mocked(saveRequestUsage).mockClear();
  for (const method of ["log", "info", "warn", "error", "debug"]) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
  restoreOriginalFetch();
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.originalDataDir;
  fs.rmSync(state.dataDir, { recursive: true, force: true });
});

// ---- Dashboard import: parse, pair, import, store -------------------------------------------
async function importConnection(id, account, cookies = [CASES[id].cookie(account)], origin = CASES[id].origin) {
  const pairingResponse = await pair(new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
    method: "POST", headers: { "content-type": "application/json", origin: DASHBOARD }, body: JSON.stringify({ provider: id, action: "create", name: `${id} ${account}` }),
  }));
  expect(pairingResponse.status, id).toBe(201);
  const { pairing } = await pairingResponse.json();
  const response = await importCookies(new NextRequest(pairing.importUrl, {
    method: "POST", headers: { "content-type": "application/json", origin: DASHBOARD, [PAIRING_HEADER]: pairing.token },
    body: JSON.stringify({ provider: id, origin, cookies: cookies.map((cookie) => ({ secure: true, ...cookie })) }),
  }));
  return { pairing, response };
}
async function connectionFor(id, account) {
  const { response } = await importConnection(id, account);
  expect(response.status, id).toBe(201);
  const { connection } = await response.json();
  return getProviderConnectionById(connection.id);
}

const dispatch = (connection, { endpoint = "/v1/chat/completions", format = FORMATS.OPENAI, stream = false } = {}) => {
  const { model } = CASES[connection.provider];
  const body = { model: `${connection.provider}/${model}`, messages: [{ role: "user", content: "ping" }], stream, ...(format === FORMATS.CLAUDE ? { max_tokens: 50 } : null) };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return handleChatCore({
    body, modelInfo: { provider: connection.provider, model }, credentials: { apiKey: connection.apiKey, authType: connection.authType },
    clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: connection.id, log,
    rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
};

describe("1127 web-session registration", () => {
  it.each(IDS)("%s is a registered, unstaged webCookie provider with its own executor", (id) => {
    const { executor, alias, apiKeyTwin } = CASES[id];
    const entry = REGISTRY.find((candidate) => candidate.id === id);
    expect(entry).toMatchObject({ category: "webCookie", authType: "cookie", transport: { executor: id, authType: "cookie" } });
    expect(entry.staged).not.toBe(true);
    expect(STAGED_PROVIDERS[id]).toBeUndefined();
    expect(hasSpecializedExecutor(id)).toBe(true);
    expect(getExecutor(id)).toBeInstanceOf(executor);
    if (alias) {
      expect(REGISTERED_EXECUTOR_IDS).toContain(alias);
      expect(getExecutor(alias)).toBe(getExecutor(id));
    }
    // The API-key counterpart keeps its own identity, category and executor.
    const twin = REGISTRY.find((candidate) => candidate.id === apiKeyTwin);
    expect(twin.category).toBe("apikey");
    expect(getExecutor(apiKeyTwin)).not.toBe(getExecutor(id));
    expect(getExecutor(apiKeyTwin)).not.toBeInstanceOf(executor);
    // Dashboard catalog: import profile on the provider's exact origin, extension capture off, no web login.
    expect(WEB_COOKIE_PROVIDERS[id].cookieImport).toMatchObject({ origin: CASES[id].origin, extensionCapture: false, cookieNames: [CASES[id].cookie("a").name] });
    expect(WEB_COOKIE_PROVIDERS[id].webLogin).toBeUndefined();
    expect(typeof PROVIDER_MODELS_CONFIG[id]?.customResolver).toBe("function");
  });

  it.each(IDS)("%s parses Cookie header, cURL and HAR input down to the one approved cookie", (id) => {
    const { origin, cookie } = CASES[id];
    const contract = WEB_COOKIE_PROVIDERS[id].cookieImport;
    const wanted = cookie("a");
    const header = `theme=dark; ${wanted.name}=${wanted.value}; other=x`;
    const curl = `curl '${origin}/' -H 'Cookie: ${header}'`;
    const har = JSON.stringify({ log: { entries: [
      { request: { url: `${origin}/`, headers: [{ name: "Cookie", value: header }], cookies: [] } },
      { request: { url: "https://unrelated.example/", headers: [{ name: "Cookie", value: `${wanted.name}=foreign` }], cookies: [] } },
    ] } });
    const inputs = [
      { kind: "header", parsed: parseCookieHeaderValue(header) },
      { kind: "curl", parsed: parseCurlCommand(curl) },
      { kind: "har", parsed: parseHarDocument(har) },
    ];
    for (const input of inputs) {
      const built = buildImportCandidates(input, contract);
      expect(built.ok, `${id} ${input.kind}`).toBe(true);
      expect(built.candidates, `${id} ${input.kind}`).toHaveLength(1);
      expect(built.candidates[0].origin).toBe(origin);
      const kept = filterCandidateCookies(built.candidates[0], contract);
      expect(kept.cookies.map(({ name, value }) => `${name}=${value}`), `${id} ${input.kind}`).toEqual([`${wanted.name}=${wanted.value}`]);
    }
    // A cURL command for another origin is refused, never re-targeted.
    expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://foreign.example/' -H 'Cookie: ${header}'`) }, contract).ok).toBe(false);
  });

  it.each(IDS)("%s imports through the dashboard into a cookie connection holding only the approved cookie", async (id) => {
    const extra = { name: "unapproved", value: "x", domain: CASES[id].cookie("a").domain };
    expect((await importConnection(id, "a", [CASES[id].cookie("a"), extra])).response.status).toBe(400);
    expect((await importConnection(id, "a", undefined, "https://foreign.example")).response.status).toBe(400);
    expect((await importConnection(id, "a", [{ ...CASES[id].cookie("a"), domain: "foreign.example" }])).response.status).toBe(400);
    const connection = await connectionFor(id, "a");
    expect(connection).toMatchObject({ provider: id, authType: "cookie", apiKey: CASES[id].stored("a") });
    expect(wire.calls).toEqual([]);
  });

  it.each(IDS)("%s discovers models for the selected connection only", async (id) => {
    const a = await connectionFor(id, "a");
    const b = await connectionFor(id, "b");
    const listA = await fetchConnectionModels(a);
    const listB = await fetchConnectionModels(b);
    expect(listA.error, id).toBeUndefined();
    expect(listA.models.map((model) => model.id)).toContain(CASES[id].model);
    if (id === "inner-ai-web") {
      expect(listA.models.map((model) => model.id)).toEqual(["gpt-4o", "only-a"]);
      expect(listB.models.map((model) => model.id)).toEqual(["gpt-4o", "only-b"]);
    } else {
      expect(listB.models).toEqual(listA.models);
    }
    // Poe and v0 answer their pinned lists without sending the cookie; Venice makes one read-only GET.
    const sent = wire.calls.map((call) => call.url);
    if (id === "poe-web" || id === "v0-vercel-web") expect(sent).toEqual([]);
    if (id === "venice-web") expect(sent).toEqual([VENICE_WEB_CLIENT_URL, VENICE_WEB_CLIENT_URL]);
    expect(wire.calls.every((call) => call.url !== CASES[id].chatUrl)).toBe(true);
  });

  it.each([["inner-ai-web"], ["venice-web"]])("%s validates with a read-only check and maps rejection to invalid", async (id) => {
    const valid = await probeRegistryProvider(id, CASES[id].stored("a"), upstream);
    expect(valid).toMatchObject({ valid: true });
    expect(chatCalls(id)).toEqual([]);
    const rejected = await probeRegistryProvider(id, CASES[id].stored("a").replace(/.$/, "x"), upstream);
    expect(rejected.valid).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain(LEAK);
  });

  it.each([["poe-web"], ["v0-vercel-web"]])("%s is never probed through its chat endpoint", (id) => {
    expect(isConversationProbeProvider(id)).toBe(true);
  });

  it.each(IDS.flatMap((id) => [
    [id, "/v1/chat/completions", FORMATS.OPENAI, false],
    [id, "/v1/chat/completions", FORMATS.OPENAI, true],
    [id, "/v1/messages", FORMATS.CLAUDE, false],
    [id, "/v1/messages", FORMATS.CLAUDE, true],
  ]))("%s serves %s (%s, stream=%s) for the selected account and records usage", async (id, endpoint, format, stream) => {
    await connectionFor(id, "b");
    const connection = await connectionFor(id, "a");
    const result = await dispatch(connection, { endpoint, format, stream });
    expect(result.response.status).toBe(200);
    const raw = await result.response.text();
    expect(raw).toContain(reply("a"));
    expect(raw).not.toContain(reply("b"));
    if (format === FORMATS.CLAUDE && !stream) expect(JSON.parse(raw)).toMatchObject({ type: "message", role: "assistant" });
    if (format === FORMATS.CLAUDE && stream) expect(raw).toContain("event: message_stop");
    if (format === FORMATS.OPENAI && stream) expect(raw).toContain("data: [DONE]");
    expect(chatCalls(id)).toHaveLength(1);
    // The shared transport never follows a redirect while carrying the session.
    expect(["manual", "error"]).toContain(chatCalls(id)[0].init.redirect);
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalled());
    expect(saveRequestUsage.mock.calls).toHaveLength(1);
    const saved = saveRequestUsage.mock.calls[0][0];
    expect(saved).toMatchObject({ provider: id, model: CASES[id].model, connectionId: connection.id });
    expect(saved.tokens.prompt_tokens ?? saved.tokens.input_tokens).toBeGreaterThan(0);
    expect(saved.tokens.completion_tokens ?? saved.tokens.output_tokens).toBeGreaterThan(0);
    // v0 reports real counts on JSON; the others get the gateway's marked estimate.
    if (id === "v0-vercel-web" && !stream) expect(saved.tokens).toMatchObject({ prompt_tokens: 3, completion_tokens: 4 });
    else if (id !== "v0-vercel-web") expect(saved.tokens.estimated).toBe(true);
  });

  it.each(IDS)("%s maps an expired session (401) to account handling without leaking upstream text", async (id) => {
    const connection = await connectionFor(id, "a");
    wire.override[CASES[id].chatUrl] = () => new Response(LEAK, { status: 401 });
    const result = await dispatch(connection);
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(JSON.stringify(result.error ?? "")).not.toContain(LEAK);
  });

  it.each(IDS)("%s refuses a redirect from the chat endpoint and never follows it", async (id) => {
    const connection = await connectionFor(id, "a");
    wire.override[CASES[id].chatUrl] = () => new Response(null, { status: 302, headers: { location: "https://redirect.example/steal" } });
    const result = await dispatch(connection);
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(wire.followed).toEqual([]);
    expect(wire.calls.some((call) => call.url.startsWith("https://redirect.example"))).toBe(false);
  });

  it.each(IDS)("%s maps an upstream server error to a gateway error", async (id) => {
    const connection = await connectionFor(id, "a");
    wire.override[CASES[id].chatUrl] = () => new Response(LEAK, { status: 500 });
    const result = await dispatch(connection);
    expect(result.success).toBe(false);
    expect(result.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(result.error ?? "")).not.toContain(LEAK);
  });

  it("refuses an Inner.ai Web token past its exp before any request", async () => {
    const expired = jwt({ device_id: "device-x", exp: Math.floor(Date.now() / 1000) - 60 }, "inner-expired");
    const result = await dispatch({ id: "synthetic-expired", provider: "inner-ai-web", authType: "cookie", apiKey: `token=${expired}` });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(wire.calls).toEqual([]);
  });

  it("refuses a Venice Web cookie whose Clerk client has no active session", async () => {
    const connection = await connectionFor("venice-web", "a");
    wire.override[VENICE_WEB_CLIENT_URL] = () => Response.json({ response: { sessions: [{ id: "sess_a", status: "ended" }] } });
    const result = await dispatch({ ...connection, apiKey: `__client=${jwt({ id: "client_synthetic_c" }, "venice-c")}` });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(chatCalls("venice-web")).toEqual([]);
  });
});
