// UC (uncensored.com) consumer email sign-in and scoped Clerk sessions, staged
// and unregistered (#1241, #2034). Closed mocks only: every Clerk call goes
// through a synthetic transport that fails the test on an unexpected request,
// every email, code, cookie and JWT is synthetic, and no browser, mailbox or
// network is involved. Wire shapes follow OmniRoute c71f0065
// (executors/uc/emailLogin.ts, clerkAuth.ts, credentials.ts, constants.ts).
// Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UC_SIGNIN_METADATA_KEYS,
  buildUcConnectionMetadata,
  clampRefreshSkew,
  createUcSessionController,
  createUcSignInController,
  importUcCookies,
  parseSetCookies,
} from "../../open-sse/services/providerParity/native-uc-signin/index.js";
import { mintUcSessionToken, resolveUcCredential } from "../../open-sse/services/providerParity/native-uc-tts/index.js";
import { ucToken } from "../../open-sse/services/providerParity/native-uc-video-image/index.js";

const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-uc-signin/registration.json", import.meta.url), "utf8"));

const CLERK = "https://clerk.uncensored.com";
const QUERY = "?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1";
// The token mint carries only the JS version (clerkAuth.ts:95).
const MINT_QUERY = "?_clerk_js_version=5.127.1";
const ENV = Object.freeze({ DURINDOOR_UC_CONSUMER_SIGNIN: "1" });
const EMAIL = "synthetic.user@example.test";
const CODE = "424242";

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwtFor = (claims, tag = "x") => `${b64url({ alg: "RS256" })}.${b64url(claims)}.SYNTHETICsig${tag}`;

const A = { uid: "0a1b2c3d-0000-4000-8000-00000000000a", sid: "sess_SYNTHa", sia: "sia_SYNTHa", idn: "idn_SYNTHa", client: "SYNTHETIC-client-aaaa", rotated: "SYNTHETIC-client-a2" };
const B = { uid: "0a1b2c3d-0000-4000-8000-00000000000b", sid: "sess_SYNTHb", sia: "sia_SYNTHb", idn: "idn_SYNTHb", client: "SYNTHETIC-client-bbbb", rotated: "SYNTHETIC-client-b2" };

let clock = 1_800_000_000_000;
const now = () => clock;
const jwtAt = (account, lifetimeS = 60, extra = {}) => jwtFor({ uid: account.uid, sid: account.sid, exp: Math.floor(clock / 1000) + lifetimeS, ...extra }, account.uid.slice(-1));

const reply = (status, body, cookies = []) => {
  const headers = new Headers([["content-type", "application/json"], ...cookies.map((c) => ["set-cookie", c])]);
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });
};

/** Synthetic Clerk transport: `routes` maps "METHOD path" to a handler; anything else fails. */
function transport(routes) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url, path: parsed.pathname, init, form: Object.fromEntries(new URLSearchParams(init.body)) });
    const handler = routes[`${init.method} ${parsed.pathname}`];
    if (!handler) throw new Error(`unexpected request ${init.method} ${parsed.pathname}`);
    return handler({ url, init, form: Object.fromEntries(new URLSearchParams(init.body)), calls });
  });
  return { fetchImpl, calls };
}

const signInRoutes = (account, overrides = {}) => ({
  "POST /v1/client/sign_ins": () => reply(200, {
    response: { object: "sign_in_attempt", id: account.sia, status: "needs_first_factor", supported_first_factors: [{ strategy: "password" }, { strategy: "email_code", email_address_id: account.idn, safe_identifier: "s***@example.test" }] },
    client: { id: "client_SYNTH" },
  }, [`__client=${account.client}; Path=/; Domain=.uncensored.com; HttpOnly; Secure`, "__client_uat=0; Path=/; Domain=uncensored.com"]),
  [`POST /v1/client/sign_ins/${account.sia}/prepare_first_factor`]: () => reply(200, { response: { id: account.sia, status: "needs_first_factor", first_factor_verification: { status: "unverified", strategy: "email_code" } } }),
  [`POST /v1/client/sign_ins/${account.sia}/attempt_first_factor`]: ({ form }) => form.code === CODE
    // Source success shape (emailLogin.ts:23-28, 260-303): uid is the session's user.id, __client is in Set-Cookie.
    ? reply(200, { response: { id: account.sia, status: "complete", created_session_id: account.sid }, client: { sessions: [{ id: account.sid, user: { id: account.uid } }] } }, [`__client=${account.client}; Path=/; Domain=.uncensored.com; HttpOnly; Secure`, "__client_uat=1800000000; Path=/; Domain=uncensored.com"])
    : reply(422, { errors: [{ code: "form_code_incorrect", message: `bad code ${form.code}` }] }),
  [`POST /v1/client/sessions/${account.sid}/tokens`]: () => reply(200, { object: "token", jwt: jwtAt(account) }),
  ...overrides,
});

const signIn = (t, extra = {}) => createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now, ...extra });

const credsFor = (account, extra = {}) => ({
  providerSpecificData: { ucClientCookie: account.client, ucSid: account.sid, ucUid: account.uid, ucCookies: { __client: account.client, __cf_bm: `SYNTHETIC-cf-${account.uid.slice(-1)}` }, ...extra },
});

const secretsOf = (account) => [account.client, account.rotated, account.sia, account.idn, EMAIL, CODE];
const expectNoSecrets = (value, account) => {
  const text = JSON.stringify(value);
  for (const secret of secretsOf(account)) expect(text).not.toContain(secret);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clock = 1_800_000_000_000;
});

describe("opt-in guard", () => {
  it("refuses every call without the operator env and makes no request", async () => {
    const t = transport({});
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: {}, now });
    expect(await controller.start({ email: EMAIL, consent: true })).toMatchObject({ ok: false, kind: "disabled", httpStatus: 403 });
    expect(await controller.verify({ flowId: "x", code: CODE })).toMatchObject({ kind: "disabled" });
    expect(await createUcSessionController({ fetchImpl: t.fetchImpl, env: { DURINDOOR_UC_CONSUMER_SIGNIN: "true" } }).getSessionToken(credsFor(A))).toMatchObject({ kind: "disabled" });
    expect(await importUcCookies({ consent: true, fields: credsFor(A).providerSpecificData }, { fetchImpl: t.fetchImpl, env: {} })).toMatchObject({ kind: "disabled" });
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("needs consent: true on start and import", async () => {
    const t = transport({});
    for (const consent of [undefined, false, "true", 1]) {
      expect(await signIn(t).start({ email: EMAIL, consent })).toMatchObject({ kind: "consent_required" });
      expect(await importUcCookies({ consent, fields: credsFor(A).providerSpecificData }, { fetchImpl: t.fetchImpl, env: ENV })).toMatchObject({ kind: "consent_required" });
    }
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses malformed email before any request", async () => {
    const t = transport({});
    for (const email of ["", "no-at", "a@b", `${"a".repeat(65)}@example.test`, "a b@example.test", "a@exa mple.test", 42, null]) {
      expect(await signIn(t).start({ email, consent: true })).toMatchObject({ kind: "invalid_input" });
    }
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("email-code sign-in", () => {
  it("sends the source wire shape and returns only an opaque flow id", async () => {
    const t = transport(signInRoutes(A));
    const started = await signIn(t).start({ email: ` ${EMAIL} `, consent: true });
    expect(started).toEqual({ ok: true, flowId: expect.stringMatching(/^[0-9a-f-]{36}$/), state: "code_sent", expiresAt: clock + 600_000, attemptsLeft: 5 });
    expectNoSecrets(started, A);
    expect(t.calls.map((c) => c.url)).toEqual([
      `${CLERK}/v1/client/sign_ins${QUERY}`,
      `${CLERK}/v1/client/sign_ins/${A.sia}/prepare_first_factor${QUERY}`,
    ]);
    const [create, prepare] = t.calls;
    expect(create.form).toEqual({ locale: "en-CA", identifier: EMAIL });
    expect(create.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(create.init.headers).toEqual({ Origin: "https://uncensored.com", Referer: "https://uncensored.com/", "Content-Type": "application/x-www-form-urlencoded" });
    expect(prepare.form).toEqual({ strategy: "email_code", email_address_id: A.idn });
    expect(prepare.init.headers.Cookie).toBe(`__client=${A.client}; __client_uat=0`);
  });

  it("verifies the code and harvests metadata that the staged UC adapters accept", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t);
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    const done = await controller.verify({ flowId, code: CODE });
    expect(done.ok).toBe(true);
    expect(Object.keys(done).sort()).toEqual(["ok", "providerSpecificData"]);
    const psd = done.providerSpecificData;
    expect(Object.keys(psd).sort()).toEqual([...UC_SIGNIN_METADATA_KEYS].sort());
    expect(psd).toEqual({
      ucClientCookie: A.client,
      ucSid: A.sid,
      ucUid: A.uid,
      ucCookies: { __client: A.client, __client_uat: "1800000000" },
      ucAuthSource: "email-code",
      ucSignedInAt: new Date(clock).toISOString(),
    });
    const attempt = t.calls[2];
    expect(attempt.form).toEqual({ strategy: "email_code", code: CODE });
    expect(attempt.init.headers.Cookie).toContain(`__client=${A.client}`);
    expect(t.calls[3].url).toBe(`${CLERK}/v1/client/sessions/${A.sid}/tokens${MINT_QUERY}`);
    expect(controller.pending).toBe(0);
    expect(JSON.stringify(done)).not.toContain(EMAIL);
    expect(JSON.stringify(done)).not.toContain(A.sia);

    // Staged TTS credential resolver and its real Clerk mint take the metadata as is.
    const credentials = { providerSpecificData: psd };
    expect(resolveUcCredential(credentials)).toEqual({ clientCookie: A.client, sid: A.sid, uid: A.uid, cookies: psd.ucCookies });
    const ttsFetch = vi.fn(async () => reply(200, { jwt: jwtAt(A) }));
    vi.stubGlobal("fetch", ttsFetch);
    const minted = await mintUcSessionToken(resolveUcCredential(credentials));
    expect(minted).toEqual({ ok: true, jwt: jwtAt(A) });
    expect(ttsFetch.mock.calls[0][0]).toBe(`${CLERK}/v1/client/sessions/${A.sid}/tokens?_clerk_js_version=5.127.1`);
    expect(ttsFetch.mock.calls[0][1].headers.Cookie).toContain(`__client=${A.client}`);

    // The uc-direct media adapters never see a key from it, and no key is produced.
    expect(ucToken(credentials)).toBeNull();
    expect(psd).not.toHaveProperty("apiKey");
    expect(JSON.stringify(psd)).not.toMatch(/uai_/);
  });

  it("allows a wrong code until the bounded attempts run out", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t, { maxVerifyAttempts: 3 });
    const { flowId, attemptsLeft } = await controller.start({ email: EMAIL, consent: true });
    expect(attemptsLeft).toBe(3);
    const wrong = await controller.verify({ flowId, code: "111111" });
    expect(wrong).toMatchObject({ ok: false, kind: "code_incorrect", attemptsLeft: 2 });
    expect(JSON.stringify(wrong)).not.toContain("111111");
    expect(await controller.verify({ flowId, code: "not-digits" })).toMatchObject({ kind: "invalid_input", attemptsLeft: 2 });
    expect(await controller.verify({ flowId, code: "222222" })).toMatchObject({ kind: "code_incorrect", attemptsLeft: 1 });
    expect(await controller.verify({ flowId, code: "333333" })).toMatchObject({ kind: "attempts_exhausted", httpStatus: 410 });
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "unknown_flow" });
    expect(t.calls.filter((c) => c.path.endsWith("attempt_first_factor"))).toHaveLength(3);
  });

  it("recovers after a wrong code and still signs in", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t);
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    await controller.verify({ flowId, code: "000000" });
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ ok: true, providerSpecificData: { ucUid: A.uid } });
  });

  it("maps a captcha or bot challenge to needs_operator without retrying", async () => {
    for (const answer of [
      () => reply(403, { errors: [{ code: "requires_captcha" }] }),
      () => reply(400, { errors: [{ code: "captcha_invalid" }] }),
      () => reply(401, {}),
    ]) {
      const t = transport(signInRoutes(A, { "POST /v1/client/sign_ins": answer }));
      const controller = signIn(t);
      expect(await controller.start({ email: EMAIL, consent: true })).toMatchObject({ ok: false, kind: "needs_operator", reason: "challenge", httpStatus: 409 });
      expect(t.calls).toHaveLength(1);
      expect(controller.pending).toBe(0);
    }
  });

  it("maps MFA and unsupported factors to needs_operator", async () => {
    const mfa = transport(signInRoutes(A, {
      [`POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`]: () => reply(200, { response: { id: A.sia, status: "needs_second_factor", supported_second_factors: [{ strategy: "totp" }] } }),
    }));
    const controller = signIn(mfa);
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "needs_operator", reason: "mfa" });
    expect(mfa.calls.some((c) => c.path.includes("/sessions/"))).toBe(false);
    expect(controller.pending).toBe(0);

    const passwordOnly = transport(signInRoutes(A, {
      "POST /v1/client/sign_ins": () => reply(200, { response: { id: A.sia, status: "needs_first_factor", supported_first_factors: [{ strategy: "password" }] } }, [`__client=${A.client}`]),
    }));
    expect(await signIn(passwordOnly).start({ email: EMAIL, consent: true })).toMatchObject({ kind: "needs_operator", reason: "unsupported_factor" });
    expect(passwordOnly.calls).toHaveLength(1);
  });

  it("maps refusals, rate limits and transport failures", async () => {
    const cases = [
      [() => reply(422, { errors: [{ code: "form_identifier_not_found", message: EMAIL }] }), { kind: "rejected", reason: "form_identifier_not_found" }],
      [() => reply(429, { errors: [] }, []), { kind: "rate_limited", httpStatus: 429 }],
      [() => reply(502, { errors: [{ message: EMAIL }] }), { kind: "upstream", status: 502 }],
      [() => reply(302, undefined), { kind: "redirect" }],
      [() => { throw new Error(`connect ECONNREFUSED ${EMAIL}`); }, { kind: "network" }],
      [() => new Response("{not json", { status: 200 }), { kind: "malformed" }],
      [() => reply(200, { response: { id: "not-a-sia", status: "needs_first_factor" } }, [`__client=${A.client}`]), { kind: "malformed" }],
    ];
    for (const [answer, expected] of cases) {
      const t = transport(signInRoutes(A, { "POST /v1/client/sign_ins": answer }));
      const result = await signIn(t).start({ email: EMAIL, consent: true });
      expect(result).toMatchObject({ ok: false, ...expected });
      expectNoSecrets(result, A);
    }
  });

  it("refuses an answer from another origin", async () => {
    const t = transport(signInRoutes(A, {
      "POST /v1/client/sign_ins": () => {
        const response = reply(200, {});
        Object.defineProperty(response, "url", { value: "https://evil.example.test/v1/client/sign_ins" });
        return response;
      },
    }));
    expect(await signIn(t).start({ email: EMAIL, consent: true })).toMatchObject({ kind: "foreign" });
  });

  it("never saves a malformed success", async () => {
    const attemptPath = `POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`;
    const mintPath = `POST /v1/client/sessions/${A.sid}/tokens`;
    const complete = (extra = {}, sessions = [{ id: A.sid, user: { id: A.uid } }]) => () =>
      reply(200, { response: { id: A.sia, status: "complete", created_session_id: A.sid, ...extra }, client: { sessions } }, [`__client=${A.client}; Domain=.uncensored.com`]);
    const cases = [
      { [attemptPath]: complete({ created_session_id: null }) },
      { [attemptPath]: complete({ created_session_id: "sess_bad;id" }) },
      { [attemptPath]: () => reply(200, { response: { id: A.sia, status: "complete", created_session_id: A.sid }, client: { sessions: [{ id: A.sid, user: { id: A.uid } }] } }, ["__client=; Max-Age=0; Domain=uncensored.com"]) },
      { [attemptPath]: complete(), [mintPath]: () => reply(200, { jwt: "not a jwt" }) },
      // Only the created session's user names the uid; no sessions[0] fallback, no unsafe uid.
      { [attemptPath]: complete({}, [{ id: B.sid, user: { id: B.uid } }]) },
      { [attemptPath]: complete({}, [{ id: A.sid, user: { id: "bad uid!" } }]) },
      { [attemptPath]: complete({}, []) },
      // The minted JWT names another account or session.
      { [mintPath]: () => reply(200, { jwt: jwtAt(B) }) },
      { [attemptPath]: complete(), [mintPath]: () => reply(200, { jwt: jwtFor({ uid: "bad uid!", exp: 9_999_999_999 }) }) },
      { [mintPath]: () => reply(200, { jwt: jwtFor({ uid: A.uid, sid: B.sid, exp: 9_999_999_999 }) }) },
      { [attemptPath]: () => reply(200, { response: { id: A.sia, status: "abandoned" } }) },
    ];
    const kinds = [];
    for (const overrides of cases) {
      const t = transport(signInRoutes(A, overrides));
      const controller = signIn(t);
      const { flowId } = await controller.start({ email: EMAIL, consent: true });
      const result = await controller.verify({ flowId, code: CODE });
      kinds.push(result.kind);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("providerSpecificData");
      expect(controller.pending).toBe(0);
      expectNoSecrets(result, A);
    }
    expect(kinds).toEqual(["malformed", "malformed", "malformed", "malformed", "malformed", "malformed", "malformed", "identity", "identity", "identity", "needs_operator"]);
  });

  it("accepts no sign-in state from the caller body", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t);
    await controller.start({ email: EMAIL, consent: true, signInId: B.sia, cookies: { __client: B.client }, sid: B.sid });
    expect(t.calls[0].init.headers).not.toHaveProperty("Cookie");
    expect(t.calls[1].path).toBe(`/v1/client/sign_ins/${A.sia}/prepare_first_factor`);
    for (const forged of [{ signInId: A.sia, code: CODE }, { flowId: A.sia, code: CODE }, { flowId: "00000000-0000-4000-8000-000000000000", code: CODE }, { flowId: { toString: () => "x" }, code: CODE }]) {
      expect(await controller.verify(forged)).toMatchObject({ kind: "unknown_flow" });
    }
    expect(t.calls).toHaveLength(2);
  });

  it("bounds the number of pending flows", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t, { maxPendingFlows: 2 });
    expect((await controller.start({ email: EMAIL, consent: true })).ok).toBe(true);
    expect((await controller.start({ email: EMAIL, consent: true })).ok).toBe(true);
    expect(await controller.start({ email: EMAIL, consent: true })).toMatchObject({ kind: "capacity", httpStatus: 429 });
    clock += 600_001;
    expect(controller.pending).toBe(0);
    expect((await controller.start({ email: EMAIL, consent: true })).ok).toBe(true);
  });

  it("expires a flow after its lifetime", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t, { flowTtlMs: 60_000 });
    const { flowId, expiresAt } = await controller.start({ email: EMAIL, consent: true });
    expect(expiresAt).toBe(clock + 60_000);
    clock += 60_000;
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "expired" });
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "unknown_flow" });
    expect(t.calls.some((c) => c.path.endsWith("attempt_first_factor"))).toBe(false);
  });

  it("maps an expired Clerk verification and ends the flow", async () => {
    const t = transport(signInRoutes(A, {
      [`POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`]: () => reply(422, { errors: [{ code: "verification_expired" }] }),
    }));
    const controller = signIn(t);
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "expired" });
    expect(controller.pending).toBe(0);
  });

  it("cancels a pending flow, including one mid-verify, and never returns metadata after", async () => {
    let release;
    const t = transport(signInRoutes(A, {
      [`POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`]: () => new Promise((resolve) => {
        release = () => resolve(reply(200, { response: { id: A.sia, status: "complete", created_session_id: A.sid } }));
      }),
    }));
    const controller = signIn(t);
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    const pending = controller.verify({ flowId, code: CODE });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "busy" });
    expect(controller.cancel(flowId)).toBe(true);
    release();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, kind: "cancelled" });
    expect(result).not.toHaveProperty("providerSpecificData");
    expect(t.calls.some((c) => c.path.includes("/sessions/"))).toBe(false);
    expect(controller.cancel(flowId)).toBe(false);
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ kind: "unknown_flow" });
  });

  it("bounds each request by a deadline even when the transport ignores its signal", async () => {
    const t = transport(signInRoutes(A, { "POST /v1/client/sign_ins": () => new Promise(() => {}) }));
    const controller = signIn(t, { timeoutMs: 20 });
    expect(await controller.start({ email: EMAIL, consent: true })).toMatchObject({ kind: "timeout", httpStatus: 504 });
    expect(controller.pending).toBe(0);
  });

  it("keeps the flow usable when the caller aborts a verify", async () => {
    const t = transport(signInRoutes(A));
    const controller = signIn(t);
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    const abort = new AbortController();
    abort.abort();
    expect(await controller.verify({ flowId, code: CODE }, { signal: abort.signal })).toMatchObject({ kind: "aborted", attemptsLeft: 4 });
    expect(await controller.verify({ flowId, code: CODE })).toMatchObject({ ok: true });
  });

  it("keeps two accounts' flows and jars apart", async () => {
    const t = transport({ ...signInRoutes(B), ...signInRoutes(A, {
      "POST /v1/client/sign_ins": (ctx) => (ctx.form.identifier === EMAIL ? signInRoutes(A)["POST /v1/client/sign_ins"]() : signInRoutes(B)["POST /v1/client/sign_ins"]()),
    }) });
    const controller = signIn(t);
    const a = await controller.start({ email: EMAIL, consent: true });
    const b = await controller.start({ email: "other.synthetic@example.test", consent: true });
    const doneB = await controller.verify({ flowId: b.flowId, code: CODE });
    const doneA = await controller.verify({ flowId: a.flowId, code: CODE });
    expect(doneA.providerSpecificData).toMatchObject({ ucUid: A.uid, ucSid: A.sid, ucClientCookie: A.client });
    expect(doneB.providerSpecificData).toMatchObject({ ucUid: B.uid, ucSid: B.sid, ucClientCookie: B.client });
    for (const call of t.calls) {
      const cookie = call.init.headers.Cookie ?? "";
      if (call.path.includes(A.sia) || call.path.includes(A.sid)) expect(cookie).not.toContain(B.client);
      if (call.path.includes(B.sia) || call.path.includes(B.sid)) expect(cookie).not.toContain(A.client);
    }
  });
});

describe("scoped session controller", () => {
  const sessionRoutes = (account, mint = () => reply(200, { jwt: jwtAt(account) })) => ({
    [`POST /v1/client/sessions/${account.sid}/tokens`]: mint,
  });
  const sessions = (t, extra = {}) => createUcSessionController({ fetchImpl: t.fetchImpl, env: ENV, now, ...extra });

  it("mints with only the selected account's jar and caches until the refresh skew", async () => {
    const t = transport(sessionRoutes(A));
    const controller = sessions(t, { refreshSkewMs: 10_000 });
    const first = await controller.getSessionToken(credsFor(A));
    expect(first).toEqual({ ok: true, jwt: jwtAt(A), expiresAt: clock + 60_000, cached: false, rotated: null });
    expect(t.calls[0].url).toBe(`${CLERK}/v1/client/sessions/${A.sid}/tokens${MINT_QUERY}`);
    expect(t.calls[0].init.headers.Cookie).toBe(`__client=${A.client}; __cf_bm=SYNTHETIC-cf-a`);
    expect(t.calls[0].init.body).toBe("");
    clock += 49_000;
    expect(await controller.getSessionToken(credsFor(A))).toMatchObject({ cached: true, jwt: first.jwt });
    clock += 1_001;
    expect(await controller.getSessionToken(credsFor(A))).toMatchObject({ cached: false });
    expect(t.calls).toHaveLength(2);
  });

  it("clamps the refresh skew and the cached lifetime", async () => {
    expect(clampRefreshSkew(0)).toBe(1_000);
    expect(clampRefreshSkew(3_600_000)).toBe(30_000);
    // Source default UC_TOKEN_REFRESH_SKEW_S = 8 (constants.ts:36).
    expect(clampRefreshSkew(Number.NaN)).toBe(8_000);
    const t = transport(sessionRoutes(A, () => reply(200, { jwt: jwtAt(A, 86_400) })));
    const controller = sessions(t, { refreshSkewMs: 3_600_000 });
    expect(await controller.getSessionToken(credsFor(A))).toMatchObject({ expiresAt: clock + 120_000 });
    clock += 90_001;
    expect(await controller.getSessionToken(credsFor(A))).toMatchObject({ cached: false });
  });

  it("does not cache a token already inside the skew", async () => {
    const t = transport(sessionRoutes(A, () => reply(200, { jwt: jwtAt(A, 5) })));
    const controller = sessions(t);
    await controller.getSessionToken(credsFor(A));
    await controller.getSessionToken(credsFor(A));
    expect(t.calls).toHaveLength(2);
    expect(controller.cachedAccounts).toBe(0);
  });

  it("keeps two accounts' tokens and cookies apart", async () => {
    const t = transport({ ...sessionRoutes(A), ...sessionRoutes(B) });
    const controller = sessions(t);
    const a = await controller.getSessionToken(credsFor(A));
    const b = await controller.getSessionToken(credsFor(B));
    expect(a.jwt).not.toBe(b.jwt);
    expect(t.calls[0].init.headers.Cookie).not.toContain(B.client);
    expect(t.calls[1].init.headers.Cookie).not.toContain(A.client);
    expect((await controller.getSessionToken(credsFor(B))).jwt).toBe(b.jwt);
    // Same uid and sid with another durable cookie is another cache entry.
    await controller.getSessionToken(credsFor({ ...A, client: "SYNTHETIC-client-other" }));
    expect(t.calls).toHaveLength(3);
    expect(controller.cachedAccounts).toBe(3);
  });

  it("refuses a token that names another account", async () => {
    const t = transport(sessionRoutes(A, () => reply(200, { jwt: jwtAt(B) })));
    expect(await sessions(t).getSessionToken(credsFor(A))).toMatchObject({ ok: false, kind: "identity" });
  });

  it("answers reauth on revocation and evicts the cached token", async () => {
    let revoked = false;
    const t = transport(sessionRoutes(A, () => (revoked ? reply(401, { errors: [{ code: "authentication_invalid" }] }) : reply(200, { jwt: jwtAt(A) }))));
    const controller = sessions(t);
    await controller.getSessionToken(credsFor(A));
    expect(controller.cachedAccounts).toBe(1);
    revoked = true;
    clock += 55_000;
    expect(await controller.getSessionToken(credsFor(A))).toMatchObject({ ok: false, kind: "reauth", httpStatus: 401 });
    expect(controller.cachedAccounts).toBe(0);
    // clerkAuth.ts:85-87: a 401/403 means the durable login is invalid.
    for (const answer of [() => reply(403, {}), () => reply(404, {}), () => reply(400, { errors: [{ code: "session_not_found" }] })]) {
      const other = transport(sessionRoutes(A, answer));
      expect(await sessions(other).getSessionToken(credsFor(A))).toMatchObject({ kind: "reauth" });
    }
  });

  it("makes no session touch call (the pinned source has none)", async () => {
    const t = transport(sessionRoutes(A));
    const controller = sessions(t);
    expect(controller).not.toHaveProperty("touch");
    await controller.getSessionToken(credsFor(A));
    expect(t.calls.map((c) => c.path)).toEqual([`/v1/client/sessions/${A.sid}/tokens`]);
  });

  it("hands back a rotated __client as that connection's patch only", async () => {
    const t = transport({
      ...sessionRoutes(A, () => reply(200, { jwt: jwtAt(A) }, [`__client=${A.rotated}; Domain=.uncensored.com`, "foreign=1; Domain=evil.example.test"])),
      ...sessionRoutes(B),
    });
    const controller = sessions(t);
    const a = await controller.getSessionToken(credsFor(A));
    expect(a.rotated).toEqual({ ucClientCookie: A.rotated, ucCookies: { __client: A.rotated, __cf_bm: "SYNTHETIC-cf-a" } });
    const b = await controller.getSessionToken(credsFor(B));
    expect(b.rotated).toBeNull();
    expect(t.calls[1].init.headers.Cookie).not.toContain(A.rotated);
  });

  it("refuses incomplete or unsafe credentials and ignores api keys", async () => {
    const t = transport({});
    const controller = sessions(t);
    for (const creds of [{}, { apiKey: "uai_sk_live_SYNTHETIC" }, credsFor(A, { ucSid: "sess_bad/../x" }), credsFor(A, { ucClientCookie: "a;b", ucCookies: {} }), { providerSpecificData: { ucSid: A.sid, ucUid: A.uid } }]) {
      expect(await controller.getSessionToken(creds)).toMatchObject({ kind: "invalid_credential" });
    }
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds the cache size", async () => {
    const accounts = [A, B, { ...A, sid: "sess_SYNTHc", client: "SYNTHETIC-client-cccc" }];
    const routes = Object.assign({}, ...accounts.map((acct) => sessionRoutes(acct, () => reply(200, { jwt: jwtAt(acct) }))));
    const controller = sessions(transport(routes), { maxCachedAccounts: 2 });
    for (const acct of accounts) await controller.getSessionToken(credsFor(acct));
    expect(controller.cachedAccounts).toBe(2);
  });
});

describe("cookie import", () => {
  const mint = (account, jwt = jwtAt(account)) => ({ [`POST /v1/client/sessions/${account.sid}/tokens`]: () => reply(200, { jwt }) });

  it("verifies pasted cookies with one mint and saves canonical metadata", async () => {
    const t = transport(mint(A));
    const fields = { clientCookie: `"${A.client}"`, sid: A.sid, uid: A.uid, cookies: { __cf_bm: { value: "SYNTHETIC-cf" } }, apiKey: "uai_sk_live_SYNTHETIC" };
    const result = await importUcCookies({ consent: true, fields }, { fetchImpl: t.fetchImpl, env: ENV, now });
    expect(result).toEqual({
      ok: true,
      providerSpecificData: {
        ucClientCookie: A.client,
        ucSid: A.sid,
        ucUid: A.uid,
        ucCookies: { __cf_bm: "SYNTHETIC-cf", __client: A.client },
        ucAuthSource: "cookie-import",
        ucSignedInAt: new Date(clock).toISOString(),
      },
    });
    expect(JSON.stringify(result)).not.toContain("uai_");
    expect(ucToken({ providerSpecificData: result.providerSpecificData })).toBeNull();
  });

  it("never saves cookies that do not prove the named uid", async () => {
    for (const [routes, kind] of [
      [mint(A, jwtAt(B)), "identity"],
      [mint(A, jwtFor({ uid: A.uid, sid: B.sid, exp: 9_999_999_999 })), "identity"],
      [mint(A, jwtFor({ sid: B.sid, exp: 9_999_999_999 })), "identity"],
      [{ [`POST /v1/client/sessions/${A.sid}/tokens`]: () => reply(401, {}) }, "reauth"],
    ]) {
      const t = transport(routes);
      const result = await importUcCookies({ consent: true, fields: credsFor(A).providerSpecificData }, { fetchImpl: t.fetchImpl, env: ENV, now });
      expect(result).toMatchObject({ ok: false, kind });
      expect(result).not.toHaveProperty("providerSpecificData");
    }
    const none = transport({});
    expect(await importUcCookies({ consent: true, fields: { apiKey: "uai_sk_live_SYNTHETIC" } }, { fetchImpl: none.fetchImpl, env: ENV })).toMatchObject({ kind: "invalid_credential" });
    expect(await importUcCookies({ consent: true }, { fetchImpl: none.fetchImpl, env: ENV })).toMatchObject({ kind: "invalid_credential" });
    expect(none.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("helpers and staging", () => {
  it("parses only cookie-safe Set-Cookie values scoped to uncensored.com", () => {
    const headers = new Headers([
      ["set-cookie", "__client=abc; Domain=.uncensored.com; Secure"],
      ["set-cookie", "plain=1; Path=/"],
      ["set-cookie", "foreign=1; Domain=example.test"],
      ["set-cookie", "gone=x; Max-Age=0; Domain=clerk.uncensored.com"],
      ["set-cookie", "bad name=1"],
    ]);
    expect(parseSetCookies(headers)).toEqual({ __client: "abc", plain: "1", gone: "" });
  });

  it("builds metadata only when the staged TTS resolver accepts it", () => {
    const base = { clientCookie: A.client, sid: A.sid, uid: A.uid, cookies: {}, source: "email-code", now: clock };
    expect(buildUcConnectionMetadata(base)).toMatchObject({ ucUid: A.uid });
    expect(buildUcConnectionMetadata({ ...base, source: "uc-direct" })).toBeNull();
    expect(buildUcConnectionMetadata({ ...base, uid: "bad uid" })).toBeNull();
    expect(buildUcConnectionMetadata({ ...base, cookies: { "bad name": "x" } })).toBeNull();
    expect(buildUcConnectionMetadata({ ...base, clientCookie: null })).toBeNull();
  });

  it("records the registration contract without wiring it", () => {
    expect(REGISTRATION).toMatchObject({ issue: "#1241", status: "staged-unregistered", source: { commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad" } });
    expect(REGISTRATION.endpoints.host).toBe(CLERK);
    expect(REGISTRATION.optIn.env).toBe("DURINDOOR_UC_CONSUMER_SIGNIN=1");
    expect(Object.keys(REGISTRATION.metadata.fields).sort()).toEqual([...UC_SIGNIN_METADATA_KEYS].sort());
    expect(REGISTRATION.metadata.neverStored).toEqual(expect.arrayContaining(["email", "verification code", "apiKey", "uc-direct key"]));
  });
});
