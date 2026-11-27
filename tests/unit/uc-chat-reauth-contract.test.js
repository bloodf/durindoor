// UC persona chat reauthentication contract (#1241, #2034). Closed synthetic
// mocks only: a Clerk transport that throws on any unexpected request, a fake
// persona socket driven by per-test scripts, and synthetic cookies, uids and
// JWTs. No live account, browser, mailbox or socket is involved.
//
// Source: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT)
//   - uc/clerkAuth.ts:85-87  a mint 401/403 means the durable login is
//     invalid; the caller prompts a re-login.
//   - uc/clerkAuth.ts:95     the mint query carries only _clerk_js_version.
//   - uc.ts:198-203          a mint failure matching HTTP 401/403 answers
//     401 uc_auth_error; anything else 502.
//   - uc.ts:163-164          an unauthorized/forbidden turn error is 401
//     uc_auth_error.
//   - uc/ws.ts               the source has no handshake status split; the
//     fork keeps the status and maps a socket 401/403 to 401 uc_auth_error.
// Fork-only: a session controller result of kind `needs_operator` (sign-in
// challenge or MFA, which a Clerk mint never produces) answers 403
// uc_auth_challenge before any socket opens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

import { UcChatExecutor } from "../../open-sse/services/providerParity/native-uc-chat/index.js";
import { createUcSessionController } from "../../open-sse/services/providerParity/native-uc-signin/index.js";

const CLERK = "https://clerk.uncensored.com";
const ENV = Object.freeze({ DURINDOOR_UC_CONSUMER_SIGNIN: "1" });

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
let clock = 1_900_000_000_000;
const now = () => clock;
const jwtFor = (account, lifetimeS = 60) =>
  `${b64url({ alg: "RS256" })}.${b64url({ uid: account.uid, sid: account.sid, exp: Math.floor(clock / 1000) + lifetimeS })}.SYNTHrcsig${account.tag}${clock}`;

const A = { tag: "a", uid: "5e1f0000-0000-4000-8000-00000000000a", sid: "sess_RCa", client: "SYNTHETIC-rc-client-aaaa", cf: "SYNTHETIC-rc-cf-aaaa" };
const B = { tag: "b", uid: "5e1f0000-0000-4000-8000-00000000000b", sid: "sess_RCb", client: "SYNTHETIC-rc-client-bbbb", cf: "SYNTHETIC-rc-cf-bbbb" };
const credsFor = (account) => ({
  connectionId: `conn-${account.tag}`,
  providerSpecificData: {
    ucClientCookie: account.client,
    ucSid: account.sid,
    ucUid: account.uid,
    ucCookies: { __client: account.client, __cf_bm: account.cf },
    ucAuthSource: "email-code",
    ucSignedInAt: "2026-11-01T00:00:00.000Z",
  },
});

const reply = (status, body) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let clerkCalls;
let mints;
let issued;
const fetchImpl = vi.fn(async (url, init) => {
  const parsed = new URL(url);
  clerkCalls.push({ url, sid: parsed.pathname.split("/")[4], init });
  const sid = parsed.pathname.match(/^\/v1\/client\/sessions\/([^/]+)\/tokens$/)?.[1];
  const handler = sid && mints[sid];
  if (!handler || init.method !== "POST") throw new Error(`unexpected request ${init.method} ${parsed.pathname}`);
  return handler(init);
});
const mintOk = (account, lifetimeS = 60) => () => {
  const jwt = jwtFor(account, lifetimeS);
  issued.push(jwt);
  return reply(200, { object: "token", jwt });
};

let sockets;
let scripts;
class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.sent = [];
    this.listeners = {};
    sockets.push(this);
    const script = scripts.shift();
    this.unexpected = !script;
    queueMicrotask(() => script?.(this));
  }
  on(event, handler) {
    this.listeners[event] = handler;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  terminate() {}
}
const f = (value) => JSON.stringify(value);
const answers = (...messages) => async (socket) => {
  socket.onopen?.();
  for (const m of messages) {
    await Promise.resolve();
    socket.onmessage?.({ data: m });
  }
};
const ok = (text = "ok") => answers(f({ message_type: "text", text }), f({ message_type: "text", end_of_stream: true, raw_text: text }));
const refused = (statusCode) => (socket) =>
  socket.listeners["unexpected-response"]({}, { statusCode, headers: {}, resume() {} });

const executor = (extra = {}) => new UcChatExecutor({
  sessionController: createUcSessionController({ fetchImpl, env: ENV, now, refreshSkewMs: 8_000 }),
  env: ENV,
  WebSocketImpl: FakeSocket,
  now,
  ...extra,
});
const run = (ex, { account = A, stream = false } = {}) =>
  ex.execute({ model: "claude-opus-47", body: { messages: [{ role: "user", content: "hello" }] }, stream, credentials: credsFor(account) });

async function expectRedacted(result) {
  const text = `${await result.response.clone().text()} ${JSON.stringify({ url: result.url, headers: result.headers, body: result.transformedBody })}`;
  for (const secret of [A.client, A.cf, B.client, B.cf, ...issued]) expect(text).not.toContain(secret);
  expect(text).not.toContain("token=");
}
async function expectJsonError(result, status, code) {
  expect(result.response.status).toBe(status);
  expect(result.response.headers.get("content-type")).toBe("application/json");
  await expectRedacted(result);
  expect((await result.response.json()).error.code).toBe(code);
}
const mintsFor = (account) => clerkCalls.filter((c) => c.sid === account.sid).length;

beforeEach(() => {
  clock = 1_900_000_000_000;
  clerkCalls = [];
  sockets = [];
  scripts = [];
  issued = [];
  mints = { [A.sid]: mintOk(A), [B.sid]: mintOk(B) };
  fetchImpl.mockClear();
});
afterEach(() => {
  expect(sockets.filter((s) => s.unexpected)).toEqual([]);
  expect(scripts).toEqual([]);
});

describe("Clerk mint 401/403 is a re-login (clerkAuth.ts:85-87, uc.ts:198)", () => {
  const bodies = {
    "plain 401": [401, { errors: [{ code: "authentication_invalid", message: `bad ${A.client}` }] }],
    "plain 403": [403, { errors: [{ code: "forbidden", message: `no ${A.cf}` }] }],
    "403 captcha challenge": [403, { errors: [{ code: "captcha_required", message: `challenge ${A.client}` }] }],
    "403 second-factor body": [403, { errors: [{ code: "needs_second_factor", message: "mfa" }] }],
    "403 empty body": [403, undefined],
  };
  for (const [name, [status, body]] of Object.entries(bodies)) {
    for (const stream of [false, true]) {
      it(`${name} (${stream ? "stream" : "buffered"}) -> 401 uc_auth_error, one mint, no socket`, async () => {
        mints[A.sid] = () => reply(status, body);
        const result = await run(executor(), { stream });
        await expectJsonError(result, 401, "uc_auth_error");
        expect(result.acceptedTurn).toBeUndefined();
        expect(clerkCalls).toHaveLength(1);
        expect(clerkCalls[0].url).toBe(`${CLERK}/v1/client/sessions/${A.sid}/tokens?_clerk_js_version=5.127.1`);
        expect(clerkCalls[0].init.headers.Cookie).toBe(`__client=${A.client}; __cf_bm=${A.cf}`);
        expect(sockets).toEqual([]);
      });
    }
  }

  it("is not a 403 challenge and is not retried within the request", async () => {
    mints[A.sid] = () => reply(403, { errors: [{ code: "captcha_required" }] });
    const result = await run(executor());
    const body = await result.response.json();
    expect(result.response.status).not.toBe(403);
    expect(body.error.code).not.toBe("uc_auth_challenge");
    expect(clerkCalls).toHaveLength(1);
  });

  it("a mint 5xx stays an upstream error, not a re-login", async () => {
    mints[A.sid] = () => reply(503, { errors: [{ code: "unavailable" }] });
    await expectJsonError(await run(executor()), 502, "uc_auth_upstream_error");
    expect(sockets).toEqual([]);
  });

  it("drops only the failing account's cached JWT", async () => {
    mints[A.sid] = mintOk(A, 10);
    mints[B.sid] = mintOk(B, 120);
    const ex = executor();
    scripts.push(ok(), ok());
    expect((await run(ex, { account: A })).response.status).toBe(200);
    expect((await run(ex, { account: B })).response.status).toBe(200);
    expect(ex.sessions.cachedAccounts).toBe(2);
    clock += 5_000; // A is inside the 8 s skew, B is not
    mints[A.sid] = () => reply(403, { errors: [{ code: "captcha_required" }] });
    await expectJsonError(await run(ex, { account: A }), 401, "uc_auth_error");
    expect(ex.sessions.cachedAccounts).toBe(1);
    scripts.push(ok());
    expect((await run(ex, { account: B })).response.status).toBe(200);
    expect(mintsFor(B)).toBe(1);
    expect(mintsFor(A)).toBe(2);
  });
});

describe("sign-in challenge or MFA from the session controller (fork-only 403)", () => {
  for (const reason of ["challenge", "mfa"]) {
    for (const stream of [false, true]) {
      it(`needs_operator ${reason} (${stream ? "stream" : "buffered"}) -> 403 uc_auth_challenge, no socket`, async () => {
        const sessionController = { getSessionToken: vi.fn(async () => ({ ok: false, kind: "needs_operator", reason })), forget: vi.fn() };
        const result = await run(executor({ sessionController }), { stream });
        await expectJsonError(result, 403, "uc_auth_challenge");
        expect(result.acceptedTurn).toBeUndefined();
        expect(sessionController.getSessionToken).toHaveBeenCalledTimes(1);
        expect(sessionController.forget).not.toHaveBeenCalled();
        expect(clerkCalls).toEqual([]);
        expect(sockets).toEqual([]);
      });
    }
  }
});

describe("persona socket denial is distinct from a mint failure", () => {
  for (const statusCode of [401, 403]) {
    for (const stream of [false, true]) {
      it(`socket ${statusCode} (${stream ? "stream" : "buffered"}) -> 401 uc_auth_error, no frame, own JWT dropped`, async () => {
        const ex = executor();
        scripts.push(ok());
        expect((await run(ex, { account: B })).response.status).toBe(200);
        scripts.push(refused(statusCode));
        const result = await run(ex, { stream });
        await expectJsonError(result, 401, "uc_auth_error");
        expect(result.acceptedTurn).toBeUndefined();
        expect(sockets).toHaveLength(2);
        expect(sockets[1].sent).toEqual([]);
        expect(mintsFor(A)).toBe(1);
        expect(ex.sessions.cachedAccounts).toBe(1);
        // A mints afresh on its next request; B keeps its cached JWT.
        scripts.push(ok(), ok());
        await run(ex, { account: A });
        await run(ex, { account: B });
        expect(mintsFor(A)).toBe(2);
        expect(mintsFor(B)).toBe(1);
      });
    }
  }

  it("an unauthorized frame after the send is an accepted turn and is never replayed", async () => {
    const ex = executor();
    scripts.push(answers(f({ type: "error", code: "forbidden", message: "denied" })));
    const result = await run(ex, { stream: true });
    await expectJsonError(result, 401, "uc_auth_error");
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "upstream-error" });
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(1);
    expect(ex.sessions.cachedAccounts).toBe(0);
  });
});
