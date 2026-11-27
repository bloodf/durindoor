/**
 * #2034: Windsurf typed gRPC failures, cancellation, account routing, and
 * accounting on the public chat route.
 *
 * Real: sqlite DB, handleChat, account selection, chatCore, the Windsurf
 * executor. Synthetic: every token and outbound byte; the wire is mocked at
 * proxyAwareFetch and every socket connect is refused. No provider traffic.
 */
import "../translator/registerAll.js";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-windsurf-machine-id" }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(() => "synthetic-session"), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));
const wire = vi.hoisted(() => ({ send: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (url, init, proxyOptions) => wire.send(url, init, proxyOptions),
}));

const TOKEN_A = "synthetic-windsurf-token-a";
const TOKEN_B = "synthetic-windsurf-token-b";
const SECRET = "synthetic-private-upstream-detail";
const accountOf = { [`Bearer ${TOKEN_A}`]: "A", [`Bearer ${TOKEN_B}`]: "B" };

const enc = new TextEncoder();
const dec = new TextDecoder();
function varint(value) {
  const out = [];
  let v = value >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return Uint8Array.from(out);
}
const join = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const field = (n, payload) => join([varint((n << 3) | 2), varint(payload.length), payload]);
const str = (n, value) => field(n, enc.encode(value));
const frame = (flag, payload) => {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flag;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
};
const content = (text) => frame(0, field(1, str(1, text)));
const usageDone = (prompt, completion) => frame(0, field(3, field(1, join([varint(1 << 3), varint(prompt), varint(2 << 3), varint(completion)]))));
const errorChunk = () => frame(0, field(4, str(1, SECRET)));
const trailer = (status) => frame(0x80, enc.encode(`grpc-status: ${status}\r\ngrpc-message: ${SECRET}\r\n`));
const truncated = () => Uint8Array.from([0, 0, 0, 0, 0x64, 1, 2, 3]);
const reply = (...parts) => () => new Response(join(parts), { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
const answer = reply(content("sibling answer"), usageDone(5, 2), trailer(0));

let root, db, handleChat, usage;
let sent = [];
let sends = [];
let replies = {};
let dialled = [];

async function upstream(url, init = {}, proxyOptions) {
  const account = accountOf[new Headers(init.headers).get("authorization")];
  sent.push(account);
  sends.push({ account, body: dec.decode(init.body), proxyOptions });
  const queue = replies[account];
  return (queue.length > 1 ? queue.shift() : queue[0])(url, init);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-gateway-2034-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  sent = [];
  sends = [];
  dialled = [];
  wire.send = upstream;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function refuse(...args) {
    dialled.push(JSON.stringify(args[0]?.host ?? args[0]?.[0]?.host ?? args[1] ?? "unknown"));
    process.nextTick(() => this.destroy(new Error("offline test: outbound connection refused")));
    return this;
  });
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  db = await import("../../src/lib/db/repos/connectionsRepo.js");
  usage = await import("@/lib/usageDb.js");
  const settings = await import("../../src/lib/db/repos/settingsRepo.js");
  await settings.updateSettings({ requireApiKey: false });
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

// Windsurf import-token connections carry no refresh token or expiry.
const connect = (name, accessToken, priority) => db.createProviderConnection({
  provider: "windsurf", authType: "oauth", name, email: `${name}@example.test`, accessToken, priority,
  refreshToken: null, expiresAt: null, isActive: true,
});

async function call({ model = "windsurf-combo", stream = false, headers = {}, signal, settle = 50 } = {}) {
  const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "ping" }] }),
    signal,
  }));
  const text = await response.text();
  // Let fire-and-forget bookkeeping settle before counting it.
  await new Promise((resolve) => setTimeout(resolve, settle));
  return { response, text };
}

const failedLogs = () => usage.appendRequestLog.mock.calls.map(([entry]) => entry.status).filter((s) => String(s).startsWith("FAILED"));
const details = () => usage.saveRequestDetail.mock.calls.map(([detail]) => detail);

function expectNoLeak(text) {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(TOKEN_A);
  expect(text).not.toContain(TOKEN_B);
  expect(JSON.stringify(details())).not.toContain(SECRET);
}

describe("#2034: Windsurf combo replay", () => {
  beforeEach(async () => {
    const { createCombo } = await import("../../src/lib/db/repos/combosRepo.js");
    await createCombo({ name: "windsurf-combo", models: ["windsurf/swe-1.6", "windsurf/gpt-5.5"] });
  });

  it("stops after output followed by an error trailer", async () => {
    const account = await connect("a", TOKEN_A, 1);
    replies = { A: [reply(content("half an answer"), trailer(13)), answer] };
    const { response, text } = await call();
    expect(sent).toEqual(["A"]);
    expect(sends[0].body).toContain(TOKEN_A);
    expect(response.status).toBe(502);
    expect(JSON.parse(text).error.code).toBe("upstream_outcome_unknown");
    expect(text).not.toContain("sibling answer");
    expectNoLeak(text);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
    expect(failedLogs()).toEqual(["FAILED 502"]);
    expect(details()).toEqual(expect.arrayContaining([expect.objectContaining({ status: "error", connectionId: account.id })]));
  }, 60000);

  it("permits account fallback after a no-output refusal", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [reply(trailer(14))], B: [answer] };
    const { response, text } = await call();
    expect(sent).toEqual(["A", "B"]);
    expect(response.status).toBe(200);
    expect(JSON.parse(text).choices[0].message.content).toBe("sibling answer");
  }, 60000);
});
