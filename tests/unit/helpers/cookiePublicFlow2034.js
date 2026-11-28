import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../../utils/requestDetailsCleanup.js";

/** Real SQLite + management import + public routes. Only authority and network are replaced.
 * Call after legacy adapter mocks have been unloaded. Vendor responses belong to the caller.
 */
export async function cookiePublicFlow2034(provider) {
  const listeners = new Map(["beforeExit", "exit", "SIGINT", "SIGTERM"].map((event) => [event, new Set(process.listeners(event))]));
  vi.resetModules();
  vi.doUnmock("@/lib/db/driver.js");
  vi.doUnmock("@/lib/localDb");
  vi.doMock("@/dashboardGuard", async (original) => ({
    ...(await original()),
    canAccessManagementApi: vi.fn(async (request) => request.headers.get("x-9r-cli-token") === "synthetic-operator"),
    canManageAccessConfig: vi.fn(async (request) => request.headers.get("x-9r-cli-token") === "synthetic-operator"),
    isOperatorRequest: vi.fn(async (request) => request.headers.get("x-9r-cli-token") === "synthetic-operator"),
    hasExactRequestOrigin: vi.fn(() => true),
  }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-public-2034-"));
  for (const [key, value] of Object.entries({ DATA_DIR: path.join(root, "data"), HOME: path.join(root, "home"), DURINDOOR_DATABASE_ENGINE: "sqlite", BASE_URL: "https://dashboard.example", NEXT_PUBLIC_BASE_URL: "", RESPONSE_BODY_TIMEOUT_MS: "100", PROVIDER_BODY_TIMEOUT_MS: "100" })) vi.stubEnv(key, value);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  const logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
  const proxy = await import("../../../open-sse/utils/proxyFetch.js");
  const network = vi.fn(async () => { throw Error("Unexpected external network"); });
  const restoreFetch = proxy.__setOriginalFetchForTesting(network);
  const db = await import("@/lib/db/index.js");
  const pairing = await import("../../../src/app/api/providers/cookie-import/pairing/route.js");
  const ingest = await import("../../../src/app/api/providers/cookie-import/route.js");
  const listing = await import("../../../src/app/api/providers/route.js");
  const chat = await import("../../../src/app/api/v1/chat/completions/route.js");
  const messages = await import("../../../src/app/api/v1/messages/route.js");
  const usage = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  const request = (url, body, headers = {}) => new Request(`https://dashboard.example${url}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://dashboard.example", ...headers }, body: JSON.stringify(body) });
  const pairResponse = (target, token = "synthetic-operator") => pairing.POST(request("/api/providers/cookie-import/pairing", { provider, ...target }, { "x-9r-cli-token": token }));
  async function issue(target) {
    const response = await pairResponse(target);
    expect(response.status).toBe(201);
    return (await response.json()).pairing;
  }
  async function submit(p, payload) {
    return ingest.POST(request("/api/providers/cookie-import", { provider, ...payload }, { [p.header]: p.token }));
  }
  async function imported(target, candidate) {
    const p = await issue(target);
    const response = await submit(p, { ...candidate, ...(target.connectionId ? { connectionId: target.connectionId } : { name: target.name }) });
    const text = await response.text();
    expect(response.status, text).toBe(target.action === "create" ? 201 : 200);
    const result = JSON.parse(text);
    expect(text).not.toContain(p.token);
    return db.getProviderConnectionById(result.connection.id);
  }
  async function bind(id, label) {
    const proxyUrl = `http://proxy-${label}.invalid:8080`;
    const pool = await db.createProxyPool({ name: label, proxyUrl, strictProxy: true });
    const row = await db.getProviderConnectionById(id);
    await db.updateProviderConnection(id, { providerSpecificData: { ...row.providerSpecificData, proxyPoolId: pool.id } });
    const dispatcher = Object.freeze({ label });
    proxy.__setProxyDispatcherForTesting(proxyUrl, dispatcher);
    return dispatcher;
  }
  return {
    db, network, logs, issue, submit, imported, bind, pairResponse,
    list: () => listing.GET(new Request("https://dashboard.example/api/providers", { headers: { "x-9r-cli-token": "synthetic-operator" } })),
    dispatch: ({ model, anthropic = false, stream = false, id, signal } = {}) => {
      const url = anthropic ? "/api/v1/messages" : "/api/v1/chat/completions";
      const req = request(url, { model, max_tokens: 32, stream, messages: [{ role: "user", content: "synthetic question" }] }, id ? { "x-connection-id": id } : {});
      return (anthropic ? messages : chat).POST(signal ? new Request(req, { signal }) : req);
    },
    async close() {
      await Promise.all(usage.mock.results.map((result) => result.value));
      await disposeLoadedRequestDetailsRepo();
      await global._dbAdapter?.instance?.close?.();
      delete global._dbAdapter;
      restoreFetch();
      proxy.__clearProxyDispatchersForTesting();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      for (const [event, previous] of listeners) for (const listener of process.listeners(event)) if (!previous.has(listener)) process.off(event, listener);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
