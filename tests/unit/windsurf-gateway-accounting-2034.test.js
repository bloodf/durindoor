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

async function call({ stream = false, headers = {}, signal, settle = 50 } = {}) {
  const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model: "windsurf/swe-1.6", stream, messages: [{ role: "user", content: "ping" }] }),
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

describe("#2034: trusted gRPC status maps to bounded auth and quota errors", () => {
  const sources = {
    trailer: (status) => reply(trailer(status)),
    header: (status) => () => new Response(new Uint8Array(0), { status: 200, headers: { "grpc-status": String(status), "grpc-message": SECRET } }),
  };

  it.each([
    ["trailer", 16, 401, "authentication_error", "Windsurf authentication failed"], ["header", 16, 401, "authentication_error", "Windsurf authentication failed"],
    ["trailer", 8, 429, "rate_limit_error", "Rate limit"], ["header", 8, 429, "rate_limit_error", "Rate limit"],
  ])("%s grpc-status %i on the only account ends as %i after one send", async (source, grpc, status, type, message) => {
    await connect("a", TOKEN_A, 1);
    replies = { A: [sources[source](grpc), answer] };
    const { response, text } = await call();
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(status);
    const body = JSON.parse(text);
    expect(body.error.type).toBe(type);
    // The gateway prefixes the fixed message; a 429 uses its own bounded text.
    expect(body.error.message).toContain(message);
    expectNoLeak(text);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
    expect(failedLogs()).toEqual([`FAILED ${status}`]);
  }, 60000);

  it.each([[16], [8]])("grpc-status %i before output moves to the sibling without mixing credentials", async (grpc) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [sources.trailer(grpc)], B: [answer] };
    const { response, text } = await call();
    expect(sent).toEqual(["A", "B"]);
    expect(response.status).toBe(200);
    expect(JSON.parse(text).choices[0].message.content).toBe("sibling answer");
    expect(sends[0].body).toContain(TOKEN_A);
    expect(sends[0].body).not.toContain(TOKEN_B);
    expect(sends[1].body).toContain(TOKEN_B);
    expect(sends[1].body).not.toContain(TOKEN_A);
  }, 60000);

  it("an HTTP 401 is not retried with a refreshed credential", async () => {
    await connect("a", TOKEN_A, 1);
    replies = { A: [() => new Response(SECRET, { status: 401 }), answer] };
    const { response, text } = await call();
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(401);
    expectNoLeak(text);
  }, 60000);

  it("trailers-only grpc-status 7 keeps the pinned 502 contract", async () => {
    await connect("a", TOKEN_A, 1);
    replies = { A: [reply(trailer(7))] };
    const { response, text } = await call();
    expect(sent[0]).toBe("A");
    expect(response.status).toBe(502);
    expectNoLeak(text);
  }, 60000);
});

describe("#2034: accepted Windsurf work is never replayed", () => {
  const tails = {
    "error trailer": () => [trailer(13)],
    "auth trailer": () => [trailer(16)],
    "missing trailer": () => [],
    "truncated frame": () => [truncated()],
    "error chunk": () => [errorChunk(), trailer(0)],
    "usage then error": () => [usageDone(9, 4), trailer(14)],
  };
  const cases = [];
  for (const stream of [false, true]) for (const label of Object.keys(tails)) cases.push([label, stream]);

  it.each(cases)("output then %s (stream=%s) ends on the selected account", async (label, stream) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [reply(content("half an answer"), ...tails[label]()), answer], B: [answer] };
    const { response, text } = await call({ stream });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(502);
    expect(JSON.parse(text).error.code).toBe("upstream_outcome_unknown");
    expect(text).not.toContain("half an answer");
    expect(text).not.toContain("sibling answer");
    expect(text).not.toContain("upstreamPartialOutput");
    expectNoLeak(text);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
    expect(failedLogs()).toEqual(["FAILED 502"]);
    expect(details().map((d) => d.status)).toEqual(["error"]);
  }, 60000);

  it("a 200 body that fails after acceptance ends on the selected account", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = {
      A: [() => new Response(new ReadableStream({
        start(c) { c.enqueue(content("half an answer")); },
        pull(c) { c.error(new TypeError(`socket reset ${SECRET}`)); },
      }), { status: 200 }), answer],
      B: [answer],
    };
    const { response, text } = await call({ stream: true });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(502);
    expect(JSON.parse(text).error.code).toBe("upstream_outcome_unknown");
    expectNoLeak(text);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
  }, 60000);

  it("a pinned account with accepted work ends there too", async () => {
    const a = await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [reply(content("half an answer"), trailer(13)), answer], B: [answer] };
    const { response } = await call({ headers: { "x-connection-id": a.id } });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(502);
  }, 60000);

  it("a trailers-only failure with no output keeps the sibling fallback", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [reply(trailer(14))], B: [answer] };
    const { response, text } = await call();
    expect(sent).toEqual(["A", "B"]);
    expect(response.status).toBe(200);
    expect(text).toContain("sibling answer");
  }, 60000);
});

describe("#2034: cancellation closes Windsurf resources with at most one send", () => {
  it("a request cancelled before submit sends nothing", async () => {
    await connect("a", TOKEN_A, 1);
    replies = { A: [answer] };
    const controller = new AbortController();
    controller.abort();
    await call({ signal: controller.signal }).catch(() => {});
    expect(sent).toEqual([]);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
  }, 60000);

  it("cancellation while the send is pending aborts it and tries no sibling", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    const controller = new AbortController();
    let sawAbort = false;
    replies = {
      A: [(_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => { sawAbort = true; reject(new DOMException("aborted", "AbortError")); }, { once: true });
        setTimeout(() => controller.abort(), 20);
      })],
      B: [answer],
    };
    const { response } = await call({ signal: controller.signal });
    expect(sent).toEqual(["A"]);
    expect(sawAbort).toBe(true);
    expect(response.status).toBe(499);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
  }, 60000);

  it.each([[false], [true]])("cancellation after headers cancels the upstream body (stream=%s)", async (stream) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    const controller = new AbortController();
    let cancelled = false;
    replies = {
      A: [() => {
        setTimeout(() => controller.abort(), 20);
        return new Response(new ReadableStream({
          start(c) { c.enqueue(content("half an answer")); },
          cancel() { cancelled = true; },
        }), { status: 200 });
      }],
      B: [answer],
    };
    const { response, text } = await call({ stream, signal: controller.signal });
    expect(sent).toEqual(["A"]);
    expect(cancelled).toBe(true);
    expect(response.status).toBe(499);
    expect(text).not.toContain("half an answer");
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
  }, 60000);
});

describe("#2034: completed Windsurf work keeps its protocol and accounting", () => {
  it("streams OpenAI chunks and records usage once on the selected account", async () => {
    const a = await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [reply(content("hel"), content("lo"), usageDone(5, 2), trailer(0))], B: [answer] };
    const { response, text } = await call({ stream: true });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = text.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
    expect(events.map((e) => e.choices?.[0]?.delta?.content).filter(Boolean).join("")).toBe("hello");
    expect(events.some((e) => e.choices?.[0]?.finish_reason === "stop")).toBe(true);
    expect(text).toContain("data: [DONE]");
    expect(usage.saveRequestUsage).toHaveBeenCalledOnce();
    const [row] = usage.saveRequestUsage.mock.calls[0];
    expect(row).toMatchObject({ provider: "windsurf", connectionId: a.id });
    expect(row.tokens).toMatchObject({ prompt_tokens: 5, completion_tokens: 2 });
    expect(failedLogs()).toEqual([]);
  }, 60000);

  it("a validated success clears the selected account's stale failure state", async () => {
    const a = await connect("a", TOKEN_A, 1);
    await db.updateProviderConnection(a.id, { testStatus: "unavailable", lastError: "stale failure", errorCode: 502 });
    replies = { A: [answer] };
    const { response } = await call();
    expect(response.status).toBe(200);
    const after = await db.getProviderConnectionById(a.id);
    expect(after.testStatus).toBe("active");
    expect(after.lastError ?? null).toBeNull();
  }, 60000);

  it("keeps concurrent pinned requests on their own credential and proxy route", async () => {
    const a = await connect("a", TOKEN_A, 1);
    const b = await connect("b", TOKEN_B, 2);
    replies = { A: [reply(content("from a"), trailer(0))], B: [reply(content("from b"), trailer(0))] };
    const [ra, rb] = await Promise.all([
      call({ headers: { "x-connection-id": a.id } }),
      call({ headers: { "x-connection-id": b.id } }),
    ]);
    expect(JSON.parse(ra.text).choices[0].message.content).toBe("from a");
    expect(JSON.parse(rb.text).choices[0].message.content).toBe("from b");
    expect(sent.sort()).toEqual(["A", "B"]);
    for (const { account, body } of sends) {
      expect(body).toContain(account === "A" ? TOKEN_A : TOKEN_B);
      expect(body).not.toContain(account === "A" ? TOKEN_B : TOKEN_A);
    }
  }, 60000);
});
