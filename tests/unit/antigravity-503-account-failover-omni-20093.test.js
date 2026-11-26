/**
 * An Antigravity 503 used to be retried on the same account (up to 3 times, up to
 * 10s apart) before the account loop could move on, even with a second account
 * ready. With another usable account the 503 is now handed back at once. The last
 * usable account still waits and retries.
 *
 * Real: sqlite DB, handleChat, account selection and fallback, the executor.
 * Synthetic: every token and outbound byte. No live provider traffic.
 *
 * Offline: the real proxyFetch module patches globalThis.fetch when it loads and
 * dials Google hosts over node:https, so a fetch stub alone is not enough. The
 * mock calls the synthetic upstream directly, and any socket connection fails.
 */
import "../translator/registerAll.js";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-antigravity-machine-id" }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));
const wire = vi.hoisted(() => ({ send: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (url, init) => wire.send(url, init),
}));

const MODEL = "gemini-3.1-flash-lite";
const TOKEN_A = "synthetic-antigravity-token-a";
const TOKEN_B = "synthetic-antigravity-token-b";
const accountOf = { [`Bearer ${TOKEN_A}`]: "A", [`Bearer ${TOKEN_B}`]: "B" };

let root, db, handleChat, failoverFor;
let sent = [];
let replies = {};
let dialled = [];

const unavailable503 = () => new Response(
  JSON.stringify({ error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } }),
  { status: 503, headers: { "content-type": "application/json", "retry-after": "9" } },
);
const quickUnavailable503 = () => {
  const response = unavailable503();
  response.headers.set("retry-after", "1");
  return response;
};
const emptyStream = () => new Response(
  'data: {"response":{"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}]}}\n\n',
  { status: 200, headers: { "content-type": "text/event-stream" } },
);
const answer = () => new Response(
  'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"OK"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1,"totalTokenCount":4}}}\n\n',
  { status: 200, headers: { "content-type": "text/event-stream" } },
);

async function upstream(url, init = {}) {
  if (!String(url).includes(":streamGenerateContent") && !String(url).includes(":generateContent")) {
    return new Response("{}", { status: 404 });
  }
  const account = accountOf[new Headers(init.headers).get("authorization")];
  sent.push(account);
  const queue = replies[account];
  return (queue.length > 1 ? queue.shift() : queue[0])();
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ag-503-failover-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  sent = [];
  dialled = [];
  wire.send = upstream;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function refuse(...args) {
    dialled.push(JSON.stringify(args[0]?.host ?? args[0]?.[0]?.host ?? args[1] ?? "unknown"));
    process.nextTick(() => this.destroy(new Error("offline test: outbound connection refused")));
    return this;
  });
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  ({ antigravityAccountFailover: failoverFor } = await import("../../src/sse/handlers/chat/singleModel/providerHooks.js"));
  db = await import("../../src/lib/db/repos/connectionsRepo.js");
  const settings = await import("../../src/lib/db/repos/settingsRepo.js");
  await settings.updateSettings({ requireApiKey: false });
  // After the imports, so this replaces the fetch that proxyFetch patched in.
  vi.stubGlobal("fetch", vi.fn(upstream));
}, 60000);

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  expect(dialled).toEqual([]);
});

const connect = (name, accessToken, priority) => db.createProviderConnection({
  provider: "antigravity", authType: "oauth", name, email: `${name}@example.test`, accessToken, priority,
  refreshToken: `refresh-${name}`, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  projectId: `project-${name}`, isActive: true,
});

const chat = () => handleChat(new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: `antigravity/${MODEL}`, stream: true, messages: [{ role: "user", content: "ping" }] }),
}));

describe("port(omniroute) #20093: an Antigravity 503 moves to another account", () => {
  it("moves a transient 503 to the second account without waiting on the first", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [unavailable503], B: [answer] };
    const started = Date.now();
    const response = await chat();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("OK");
    expect(sent).toEqual(["A", "B"]);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 60000);

  it("keeps waiting and retrying when there is only one account", async () => {
    await connect("a", TOKEN_A, 1);
    replies = { A: [quickUnavailable503, answer] };
    const response = await chat();
    expect(response.status).toBe(200);
    await response.text();
    expect(sent).toEqual(["A", "A"]);
  }, 60000);

  it("keeps in-place retries when a mid-stream recovery on the same account gets a 503", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    // The reply headers are already sent, so this recovery cannot change account.
    replies = { A: [emptyStream, quickUnavailable503, answer], B: [answer] };
    const response = await chat();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("OK");
    expect(sent).toEqual(["A", "A", "A"]);
  }, 60000);

  it("counts only an account that selection could pick right now, without selecting it", async () => {
    const a = await connect("a", TOKEN_A, 1);
    const b = await connect("b", TOKEN_B, 2);
    const ask = (ctx = {}, state = {}) => failoverFor(
      { provider: "antigravity", model: MODEL, ...ctx },
      { totalAttempts: 1, attemptCounts: new Map(), excludeConnectionIds: new Set(), modelCandidates: [MODEL], ...state },
      { connectionId: a.id },
    );

    const before = await db.getProviderConnectionById(b.id);
    expect(await ask()).toBe(true);
    expect(await db.getProviderConnectionById(b.id)).toEqual(before);

    // Pinned, another provider, already tried, out of attempts or out of the caller's scope.
    expect(await ask({ preferredConnectionId: a.id })).toBe(false);
    expect(await ask({ provider: "codex" })).toBe(false);
    expect(await ask({}, { excludeConnectionIds: new Set([b.id]) })).toBe(false);
    expect(await ask({}, { attemptCounts: new Map([[b.id, 3]]) })).toBe(false);
    expect(await ask({ comboRouting: { allowedConnectionIds: [a.id], restrictionApplied: true } })).toBe(false);

    await db.updateProviderConnection(b.id, { [`modelLock_${MODEL}`]: new Date(Date.now() + 60000).toISOString() });
    expect(await ask()).toBe(false);
    await db.updateProviderConnection(b.id, { [`modelLock_${MODEL}`]: null, isActive: false });
    expect(await ask()).toBe(false);
  }, 60000);
});
