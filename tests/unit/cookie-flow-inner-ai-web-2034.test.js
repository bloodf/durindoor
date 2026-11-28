// Synthetic sessions and mocked browser/network only; no live sign-in is exercised.
import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inner-cookie-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, previous, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import registry from "../../open-sse/providers/registry/index.js";
import provider from "../../open-sse/providers/registry/inner-ai-web.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { InnerAiWebExecutor } from "../../open-sse/executors/inner-ai-web.js";
import { INNER_AI_WEB_PROFILE_URL, INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_CHAT_URL } from "../../open-sse/providers/registry/inner-ai-web.js";

const dashboard = "https://dashboard.example";
const origin = "https://app.innerai.com";
const email = "owner@example.com";
const jwt = (device) => `synthetic.${Buffer.from(JSON.stringify({ device_id: device, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
let db, logs;
async function issue(target) {
  const response = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "inner-ai-web", ...target }, { origin: dashboard, "x-9r-cli-token": "operator-one" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
const submit = (pairing, body) => importCookies(request(pairing.importUrl, body, { "x-durindoor-pairing-token": pairing.token, origin: "chrome-extension://synthetic" }));
function browser(value, tabOrigin = origin, expirationDate) {
  const calls = [];
  const grants = new Set();
  const items = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: `${tabOrigin}/chat` }], get: async () => ({ id: 7, url: `${tabOrigin}/chat` }) },
    permissions: {
      contains: async (q) => items(q).every((item) => grants.has(item)),
      request: async (q) => { calls.push(["grant", q]); items(q).forEach((item) => grants.add(item)); return true; },
      remove: async (q) => { items(q).forEach((item) => grants.delete(item)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "selected", tabIds: [7] }],
      get: async (q) => { calls.push(["cookie", q]); return { name: "token", value, domain: ".innerai.com", secure: true, ...(expirationDate === undefined ? {} : { expirationDate }) }; },
      getAll: async () => { throw new Error("unexpected enumeration"); },
    },
    scripting: { executeScript: async () => { throw new Error("unexpected localStorage read"); } },
  };
  return { chrome, calls, grants };
}
async function capture(pairing, value, expirationDate) {
  const b = browser(value, origin, expirationDate);
  const plan = await prepareCapture({ chrome: b.chrome, text: JSON.stringify(pairing) });
  expect(plan.ok).toBe(true);
  let responseText = "";
  const fetch = vi.fn(async (url, init) => {
    const response = await importCookies(new NextRequest(url, init));
    responseText = await response.clone().text();
    return response;
  });
  const result = await runCapture({ chrome: b.chrome, fetch, plan: plan.plan, confirmed: confirmationFor(plan.plan) });
  return { ...b, result, fetch, responseText };
}
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => { clearPairings(); if (state.previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.previous; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("inner-ai-web real cookie import contract", () => {
  it("captures the issued pairing into the selected account and passes its stored credential to the executor", async () => {
    expect(registry).toContain(provider);
    const contract = getCookieImportContract("inner-ai-web");
    expect(contract).toMatchObject({ origin, cookieNames: ["token"], cookiePrefixes: [], accountEmail: "optional" });
    const first = jwt("device-a"), second = jwt("device-b");
    const a = await issue({ action: "create", name: "Account A", accountEmail: email });
    expect(JSON.stringify(a)).not.toContain(email);
    const captured = await capture(a, first);
    expect(captured.result.ok).toBe(true);
    expect(captured.calls.filter(([kind]) => kind === "cookie")).toEqual([["cookie", { url: `${origin}/`, name: "token", storeId: "selected" }]]);
    expect(captured.grants.size).toBe(0);
    const id = JSON.parse(captured.responseText).connection.id;
    const b = await issue({ action: "create", name: "Account B" });
    const other = await capture(b, second);
    expect(other.result.ok).toBe(true);
    const otherId = JSON.parse(other.responseText).connection.id;
    const selected = await getProviderConnectionById(id);
    expect(selected.apiKey).toBe(`token=${first} ${email}`);
    expect((await getProviderConnectionById(otherId)).apiKey).toBe(`token=${second}`);
    const update = await issue({ action: "update", connectionId: id });
    const replaced = jwt("replacement");
    expect((await capture(update, replaced)).result.ok).toBe(true);
    const credentials = await getProviderConnectionById(id);
    expect(credentials.apiKey).toBe(`token=${replaced}`);
    expect((await getProviderConnectionById(otherId)).apiKey).toBe(`token=${second}`);
    const proxy = { marker: "synthetic-selected-proxy" };
    const calls = [];
    const send = vi.fn(async (url, init, route) => {
      calls.push({ url, init, route });
      if (url === INNER_AI_WEB_PROFILE_URL) return Response.json({ data: { email } });
      if (url === INNER_AI_WEB_MODELS_URL) return Response.json({ ai_models: [{ id: "synthetic-model", llm_model: "gpt-4o" }] });
      if (url === INNER_AI_WEB_CHAT_URL) return new Response('data: {"type":"text","item":"hello"}\n\ndata: {"type":"end_stream","item":"end"}\n\n');
      throw new Error("unexpected upstream");
    });
    const proxyModule = await import("../../open-sse/utils/proxyFetch.js");
    vi.spyOn(proxyModule, "proxyAwareFetch").mockImplementation(send);
    // proxyFetch patches global fetch at import time; prevent that path from bypassing the spy.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network access"); }));
    const result = await new InnerAiWebExecutor().execute({ model: "gpt-4o", credentials, proxyOptions: proxy, body: { messages: [{ role: "user", content: "hi" }] }, stream: false });
    expect(result.response.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([INNER_AI_WEB_PROFILE_URL, INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_CHAT_URL]);
    for (const call of calls) { expect(call.route).toEqual(proxy); expect(call.init.headers["USER-TOKEN"]).toBe(replaced); }
    expect(calls[2].init.headers["USER-EMAIL"]).toBe(email);
    for (const secret of [first, second, replaced, a.token, b.token, update.token]) {
      expect(captured.responseText + other.responseText + JSON.stringify(captured.result) + JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(secret);
    }
  });

  it("filters the real contract for Cookie, cURL and HAR and rejects Clerk origin and chunks", () => {
    const contract = getCookieImportContract("inner-ai-web"), value = jwt("parser");
    const cases = [
      ["header", parseCookieHeaderValue(`Cookie: token=${value}; noise=ignored`)],
      ["curl", parseCurlCommand(`curl '${origin}/chat' -H 'Cookie: token=${value}; noise=ignored'`)],
      ["har", parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/chat`, headers: [{ name: "Cookie", value: `token=${value}` }] } }] } }))],
    ];
    for (const [kind, parsed] of cases) {
      expect(parsed.ok).toBe(true);
      expect(buildImportCandidates({ kind, parsed }, contract).candidates[0].cookies).toEqual([{ name: "token", value }]);
    }
    const foreign = parseCurlCommand(`curl 'https://clerk.innerai.com/' -H 'Cookie: token=${value}'`);
    expect(buildImportCandidates({ kind: "curl", parsed: foreign }, contract)).toMatchObject({ ok: false, error: expect.stringMatching(/origin/i) });
    const chunks = parseCookieHeaderValue("token.0=first; token.1=second");
    expect(buildImportCandidates({ kind: "header", parsed: chunks }, contract)).toMatchObject({ ok: false, error: expect.stringMatching(/token/) });
  });

  it("refuses wrong origin, expired cookies, injected email and a different update target", async () => {
    const value = jwt("refused");
    const existing = await createProviderConnection({ provider: "inner-ai-web", authType: "cookie", name: "Existing", apiKey: `token=${value}`, isActive: true }, { createOnly: true });
    const other = await createProviderConnection({ provider: "inner-ai-web", authType: "cookie", name: "Other", apiKey: `token=${value}`, isActive: true }, { createOnly: true });
    const base = { provider: "inner-ai-web", origin, cookies: [{ name: "token", value, secure: true, domain: ".innerai.com" }] };
    for (const patch of [{ origin: "https://clerk.innerai.com" }, { cookies: [{ ...base.cookies[0], expirationDate: 1 }] }, { accountEmail: "attacker@example.com" }, { connectionId: other.id }]) {
      const p = await issue({ action: "update", connectionId: existing.id });
      const response = await submit(p, { ...base, connectionId: existing.id, ...patch });
      expect([400, 409]).toContain(response.status);
      expect(await response.text()).not.toContain(value);
    }
    expect((await getProviderConnectionById(existing.id)).apiKey).toBe(`token=${value}`);
    expect((await getProviderConnectionById(other.id)).apiKey).toBe(`token=${value}`);
    state.access.mockResolvedValue(false);
    expect((await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "inner-ai-web", action: "create", name: "Denied" }, { origin: dashboard }))).status).toBe(403);
  });
});
