import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { PromptQlExecutor } from "../../open-sse/executors/promptql.js";

const state = vi.hoisted(() => ({ getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: async () => true, hasExactRequestOrigin: () => true }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as submit } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";

const origin = "https://prompt.ql.app";
const dashboard = "https://dashboard.example";
const names = ["__Host-next-auth.csrf-token", "next-auth.session-token"];
const cookies = (who) => names.map((name, i) => ({ name, value: `synthetic-${who}-${i}`, domain: "prompt.ql.app", secure: true }));
const header = (who) => cookies(who).map(({ name, value }) => `${name}=${value}`).join("; ");
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
let db;
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db); state.access.mockResolvedValue(true);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function pairing(target) {
  const response = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "promptql", ...target }, { origin: dashboard, "x-9r-cli-token": "synthetic-operator" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
async function send(p, body) {
  return submit(request(p.importUrl, body, { [p.header]: p.token }));
}
function browser(items, tabUrl = origin + "/") {
  const reads = [];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async () => ({ id: 7, url: tabUrl }) },
    permissions: { contains: async () => true, request: vi.fn(), remove: vi.fn() },
    cookies: { getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "chosen", tabIds: [7] }], get: async (q) => { reads.push(q); return items.find((c) => c.name === q.name) ?? null; }, getAll: vi.fn() },
    scripting: { executeScript: vi.fn() },
  };
  return { chrome, reads };
}

it("captures the real PromptQL contract into the paired account and consumes that stored session", async () => {
  const logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
  const p = await pairing({ action: "create", name: "Alice" });
  expect(p.contract).toMatchObject({ origin, cookieNames: names, cookiePrefixes: [] });
  const b = browser(cookies("alice"));
  const prepared = await prepareCapture({ chrome: b.chrome, text: JSON.stringify(p) });
  expect(prepared.ok).toBe(true);
  const fetchImport = vi.fn((url, init) => submit(new NextRequest(url, init)));
  const captured = await runCapture({ chrome: b.chrome, fetch: fetchImport, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  expect(captured.ok).toBe(true);
  expect(b.reads.map((r) => [r.name, r.storeId])).toEqual(names.map((n) => [n, "chosen"]));
  expect(b.chrome.cookies.getAll).not.toHaveBeenCalled();
  expect(b.chrome.scripting.executeScript).not.toHaveBeenCalled();
  const stored = await getProviderConnectionById(captured.connection.id);
  expect(stored.apiKey).toBe(header("alice"));
  const token = `e.${Buffer.from(JSON.stringify({ iss: "enrich-token", exp: 4102444800, "https://promptql.hasura.io": { "x-hasura-project-id": "synthetic-project" } })).toString("base64url")}.s`;
  const upstream = vi.fn(async (url, init) => {
    if (String(url).includes("/ddn/project/token")) { expect(new Headers(init.headers).get("cookie")).toBe(header("alice")); return Response.json({ token }); }
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
    return Response.json({ data: { llm_config: [] } });
  });
  expect(await new PromptQlExecutor({ fetch: upstream }).execute({ credentials: stored, action: "models", body: {} })).toEqual({ models: [] });
  expect(upstream).toHaveBeenCalledTimes(2);
  const visible = JSON.stringify([captured, logs.flatMap((s) => s.mock.calls)]);
  for (const secret of [p.token, ...cookies("alice").map((c) => c.value), token]) expect(visible).not.toContain(secret);
});

it("parses and selects PromptQL Cookie, cURL and HAR candidates without merging accounts", () => {
  const contract = getCookieImportContract("promptql");
  const parsed = [
    ["header", parseCookieHeaderValue(`Cookie: ${header("alice")}; tracking=noise`)],
    ["curl", parseCurlCommand(`curl '${origin}/' -H 'Cookie: ${header("alice")}'`)],
    ["har", parseHarDocument(JSON.stringify({ log: { entries: ["alice", "bob"].map((who) => ({ request: { url: origin + "/", headers: [{ name: "Cookie", value: header(who) }] } })) } }))],
  ];
  for (const [kind, input] of parsed) {
    expect(input.ok).toBe(true);
    const result = buildImportCandidates({ kind, parsed: input }, contract);
    expect(result.ok).toBe(true);
    expect(result.candidates[0].cookies).toEqual(cookies("alice").map(({ name, value }) => ({ name, value })));
    if (kind === "har") expect(candidatesAreAmbiguous(result.candidates)).toBe(true);
  }
  expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://evil.example/' -H 'Cookie: ${header("alice")}'`) }, contract).ok).toBe(false);
  expect(buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`${names[0]}=synthetic; ${names[1]}.0=synthetic`) }, contract).ok).toBe(false);
});

it("binds updates to the chosen PromptQL connection and refuses foreign origins and expired cookies", async () => {
  const alice = await createProviderConnection({ provider: "promptql", authType: "cookie", name: "Alice", apiKey: header("alice"), isActive: true }, { createOnly: true });
  const bob = await createProviderConnection({ provider: "promptql", authType: "cookie", name: "Bob", apiKey: header("bob"), isActive: true }, { createOnly: true });
  const p = await pairing({ action: "update", connectionId: alice.id });
  expect((await send(p, { provider: "promptql", connectionId: bob.id, origin, cookies: cookies("new") })).status).toBe(409);
  const update = await pairing({ action: "update", connectionId: alice.id });
  const response = await send(update, { provider: "promptql", connectionId: alice.id, origin, cookies: cookies("new") });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("synthetic-new");
  expect((await getProviderConnectionById(alice.id)).apiKey).toBe(header("new"));
  expect((await getProviderConnectionById(bob.id)).apiKey).toBe(header("bob"));
  for (const body of [{ origin: "https://prompt.ql.app.evil.example", cookies: cookies("x") }, { origin, cookies: cookies("x").map((c) => ({ ...c, expirationDate: 1 })) }]) {
    const fresh = await pairing({ action: "create", name: "Refused" });
    expect((await send(fresh, { provider: "promptql", ...body })).status).toBe(400);
  }
  const wrongTab = browser(cookies("x"), "https://evil.example/");
  const fresh = await pairing({ action: "create", name: "Tab" });
  expect((await prepareCapture({ chrome: wrongTab.chrome, text: JSON.stringify(fresh) })).code).toBe("wrong_tab");
  state.access.mockResolvedValue(false);
  expect((await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "promptql", action: "create", name: "Denied" }, { origin: dashboard }))).status).toBe(403);
});

/**
 * Public-route evidence for PromptQL (#2034). Each case imports synthetic cookies
 * through real pairing and import into isolated SQLite, binds each account to its
 * own strict proxy pool, then calls the actual OpenAI or Anthropic public route.
 * Only vendor network frames and the operator boundary are synthetic.
 */
describe("promptql public route dispatch (#2034)", () => {
  const REFRESH = "https://auth.pro.ql.app/ddn/project/token";
  const GQL = "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
  const MODEL = "pql/gpt-5.6-sol";
  const jwt = (who) => `e.${Buffer.from(JSON.stringify({ iss: "enrich-token", exp: 4102444800, "https://promptql.hasura.io": { "x-hasura-project-id": `project-${who}` } })).toString("base64url")}.${who}`;
  const accounts = ["alice", "bob", "carol"];
  const byCookie = (value) => accounts.find((who) => value === header(who));
  const byToken = (value) => accounts.find((who) => value === `Bearer ${jwt(who)}`);
  const defaults = {
    exchange: (who) => Response.json({ token: jwt(who) }),
    FetchLlmConfigs: () => Response.json({ data: { llm_config: [{ id: "cfg-sol", display_label: "Sol", model_reference: "gpt-5.6-sol", model_id: "gpt-5.6-sol" }] } }),
    StartThreadWithModel: (who) => Response.json({ data: { start_thread: { thread_id: `thread-${who}`, thread_events: [] } } }),
    QueryThreadEvents: (who) => Response.json({ data: { thread_events: [{ thread_event_id: 1, event_data: { type: "final_response", message: `synthetic reply ${who}` } }] } }),
  };
  /** Network-only vendor: identify the account by the exact credential it sent. */
  function vendor(flow, overrides = {}) {
    const calls = [];
    flow.network.mockImplementation(async (url, init) => {
      const headers = new Headers(init.headers);
      const target = String(url);
      if (target === REFRESH) {
        const who = byCookie(headers.get("cookie"));
        calls.push({ op: "exchange", who, cookie: headers.get("cookie"), authorization: headers.get("authorization"), dispatcher: init.dispatcher?.label });
        return (overrides.exchange ?? defaults.exchange)(who, init);
      }
      if (target === GQL) {
        const who = byToken(headers.get("authorization"));
        const { operationName } = JSON.parse(init.body);
        calls.push({ op: operationName, who, cookie: headers.get("cookie"), authorization: headers.get("authorization"), dispatcher: init.dispatcher?.label });
        return (overrides[operationName] ?? defaults[operationName])(who, init);
      }
      throw Error(`Unexpected vendor request ${target}`);
    });
    return calls;
  }
  const happy = (who, label) => [
    { op: "exchange", who, cookie: header(who), authorization: null, dispatcher: label },
    ...["FetchLlmConfigs", "StartThreadWithModel", "QueryThreadEvents"].map((op) => ({ op, who, cookie: null, authorization: `Bearer ${jwt(who)}`, dispatcher: label })),
  ];
  async function twoAccounts(flow, a = cookies("alice"), b = cookies("bob")) {
    const alice = await flow.imported({ action: "create", name: "Alice" }, { origin, cookies: a });
    const bob = await flow.imported({ action: "create", name: "Bob" }, { origin, cookies: b });
    await flow.bind(alice.id, "alice");
    await flow.bind(bob.id, "bob");
    return { alice, bob };
  }
  async function withFlow(run) {
    const { cookiePublicFlow2034 } = await import("./helpers/cookiePublicFlow2034.js");
    const flow = await cookiePublicFlow2034("promptql");
    try { await run(flow); } finally { await flow.close(); }
  }
  const secrets = () => [...accounts.flatMap((who) => cookies(who).map((c) => c.value)), ...accounts.map(jwt)];
  async function visibleOutput(flow, text) {
    return JSON.stringify({ text, listing: await (await flow.list()).json(), logs: flow.logs.flatMap((spy) => spy.mock.calls) });
  }

  it.each([
    [false, false, "header"], [false, true, "curl"], [true, false, "har"], [true, true, "header"],
    [false, false, "har"], [true, true, "curl"],
  ])("dispatches a pinned import through only its account and proxy (anthropic=%s, stream=%s, input=%s)", async (anthropic, stream, kind) => {
    await withFlow(async (flow) => {
      const value = header("alice");
      const parsed = kind === "header" ? parseCookieHeaderValue(`Cookie: ${value}`) : kind === "curl"
        ? parseCurlCommand(`curl '${origin}/' -H 'Cookie: ${value}'`)
        : parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/`, headers: [{ name: "Cookie", value }], cookies: [] } }] } }));
      const selected = buildImportCandidates({ kind, parsed }, getCookieImportContract("promptql"));
      expect(selected.ok).toBe(true);
      const { alice, bob } = await twoAccounts(flow, selected.candidates[0].cookies);
      expect(alice.apiKey).toBe(value);
      expect(bob.apiKey).toBe(header("bob"));
      const calls = vendor(flow);
      const response = await flow.dispatch({ model: MODEL, anthropic, stream, id: alice.id });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("synthetic reply alice");
      expect(text).not.toContain("synthetic reply bob");
      expect(calls).toEqual(happy("alice", "alice"));
      const refreshed = await flow.db.getProviderConnectionById(alice.id);
      expect(refreshed.accessToken).toBe(jwt("alice"));
      expect((await flow.db.getProviderConnectionById(bob.id)).accessToken ?? null).toBe(null);
      const output = await visibleOutput(flow, text);
      for (const secret of secrets()) expect(output).not.toContain(secret);
    });
  });
  it.each([false, true])("falls back to the other account only after a safe token-exchange refusal (stream=%s)", async (stream) => {
    await withFlow(async (flow) => {
      await twoAccounts(flow);
      let refused;
      const calls = vendor(flow, { exchange: (who) => { refused ??= who; return who === refused ? new Response("expired", { status: 401 }) : defaults.exchange(who); } });
      const response = await flow.dispatch({ model: MODEL, stream });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      const other = accounts.find((who) => who !== refused && who !== "carol");
      expect(calls).toEqual([{ op: "exchange", who: refused, cookie: header(refused), authorization: null, dispatcher: refused }, ...happy(other, other)]);
      expect(text).toContain(`synthetic reply ${other}`);
      expect(text).not.toContain(`synthetic reply ${refused}`);
      for (const secret of secrets()) expect(await visibleOutput(flow, text)).not.toContain(secret);
    });
  });

  // Only failures that end before or at the single message mutation are listed; see the report
  // for malformed, GraphQL-error, 5xx and stalled-body cases, which currently replay the thread.
  const failures = [
    ["quota", { StartThreadWithModel: () => new Response("slow down", { status: 429 }) }, ["exchange", "FetchLlmConfigs", "StartThreadWithModel"], 429],
    ["HTML token exchange", { exchange: () => new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } }) }, ["exchange"], 401],
    ["token exchange refusal", { exchange: () => new Response("expired", { status: 403 }) }, ["exchange"], 401],
  ];
  it.each(failures.flatMap(([label, overrides, ops, status]) => [false, true].flatMap((anthropic) => [false, true].map((stream) => [label, anthropic, stream, overrides, ops, status]))))(
    "returns a pinned %s failure without a success terminal or replay (anthropic=%s, stream=%s)", async (_label, anthropic, stream, overrides, ops, status) => {
      await withFlow(async (flow) => {
        const { alice } = await twoAccounts(flow);
        const calls = vendor(flow, overrides);
        const response = await flow.dispatch({ model: MODEL, anthropic, stream, id: alice.id });
        const text = await response.text();
        expect(response.status, text).toBe(status);
        for (const terminal of ["[DONE]", "message_stop", '"finish_reason":"stop"', "end_turn", "synthetic reply"]) expect(text).not.toContain(terminal);
        expect(calls).toEqual(happy("alice", "alice").filter((c) => ops.includes(c.op)));
        expect((await flow.db.getProviderConnectionById(alice.id)).accessToken ?? null).toBe(null);
        for (const secret of secrets()) expect(await visibleOutput(flow, text)).not.toContain(secret);
      });
    });

  it.each([false, true])("stops polling when the caller aborts and does not report success (stream=%s)", async (stream) => {
    await withFlow(async (flow) => {
      const { alice } = await twoAccounts(flow);
      const controller = new AbortController();
      const calls = vendor(flow, { QueryThreadEvents: () => { controller.abort(); return Response.json({ data: { thread_events: [] } }); } });
      let text = "";
      try {
        const response = await flow.dispatch({ model: MODEL, stream, id: alice.id, signal: controller.signal });
        text = await response.text();
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect(error?.name).toBe("AbortError");
      }
      expect(text).not.toContain("[DONE]");
      expect(text).not.toContain("synthetic reply");
      expect(calls).toEqual(happy("alice", "alice"));
    });
  });

  it("refuses unsafe imports without writing and binds an update to only the paired connection", async () => {
    await withFlow(async (flow) => {
      const { alice, bob } = await twoAccounts(flow);
      const before = async () => JSON.stringify(await Promise.all([alice.id, bob.id].map((id) => flow.db.getProviderConnectionById(id))));
      const snapshot = await before();
      const count = (await flow.db.getProviderConnections({ provider: "promptql" })).length;
      const refused = [
        [{ action: "create", name: "Wrong origin" }, { origin: "https://prompt.ql.app.evil.example", cookies: cookies("carol") }, 400],
        [{ action: "create", name: "Expired" }, { origin, cookies: cookies("carol").map((c) => ({ ...c, expirationDate: 1 })) }, 400],
        [{ action: "create", name: "Storage" }, { origin, cookies: cookies("carol"), localStorage: { token: "synthetic-storage" } }, 400],
        [{ action: "create", name: "Chunked" }, { origin, cookies: [cookies("carol")[0], { name: `${names[1]}.0`, value: "synthetic-chunk" }] }, 400],
        [{ action: "update", connectionId: alice.id }, { origin, cookies: cookies("carol"), connectionId: bob.id }, 409],
      ];
      for (const [target, body, status] of refused) {
        const p = await flow.issue(target);
        const response = await flow.submit(p, { ...(target.name ? { name: target.name } : null), ...body });
        const text = await response.text();
        expect(response.status, text).toBe(status);
        for (const secret of [p.token, ...secrets()]) expect(text).not.toContain(secret);
      }
      expect((await flow.pairResponse({ action: "create", name: "Denied" }, "synthetic-stranger")).status).toBe(403);
      expect(await before()).toBe(snapshot);
      expect((await flow.db.getProviderConnections({ provider: "promptql" })).length).toBe(count);

      vendor(flow);
      expect((await (await flow.dispatch({ model: MODEL, id: alice.id })).text())).toContain("synthetic reply alice");
      const updated = await flow.imported({ action: "update", connectionId: alice.id }, { origin, cookies: cookies("carol") });
      expect(updated.apiKey).toBe(header("carol"));
      expect((await flow.db.getProviderConnectionById(bob.id)).apiKey).toBe(header("bob"));
      flow.network.mockClear();
      const calls = vendor(flow);
      const response = await flow.dispatch({ model: MODEL, id: alice.id, stream: true });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(calls).toEqual(happy("carol", "alice"));
      for (const secret of secrets()) expect(await visibleOutput(flow, text)).not.toContain(secret);
    });
  });
});
