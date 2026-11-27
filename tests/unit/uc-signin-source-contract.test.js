// Source contract for the staged UC consumer sign-in (#1241, #2034).
//
// Every expectation below is read from OmniRoute at
// c71f0065a7efe9230ec23b96a12253b050c4d7ad, open-sse/executors/uc/:
//   constants.ts   :14 Clerk host, :17 JS version, :20 API version, :23 origin, :36 refresh skew 8 s
//   emailLogin.ts  :44 query, :47-55 headers, :130-135 step 1, :140-143 step-1 jar,
//                  :186-205 prepare, :229-237 attempt, :243 attempt Set-Cookie,
//                  :260-303 success shape and credential harvest
//   clerkAuth.ts   :4-6 JWT shape (RS256, iss, exp - iat = 60), :85-87 401/403 -> re-login,
//                  :95 mint URL, :96-101 mint headers, :108 empty body, :128-131 jwt | token,
//                  :156-180 per-session cache with skew
//   credentials.ts :12-15 `uid` claim equals the account uid, :62-66 uidFromSessionJwt,
//                  :110-125 resolveUcCredential
// Closed synthetic fixtures only: no network, account, mailbox or browser.
// The fixtures carry exactly the fields the source reads or documents.
import { afterEach, describe, expect, it, vi } from "vitest";

import * as signinModule from "../../open-sse/services/providerParity/native-uc-signin/index.js";
import {
  UC_CLERK_API_VERSION,
  UC_CLERK_FAPI,
  UC_CLERK_JS_VERSION,
  UC_APP_ORIGIN,
  UC_REFRESH_SKEW_DEFAULT_MS,
  createUcSessionController,
  createUcSignInController,
  importUcCookies,
  mintUcSession,
} from "../../open-sse/services/providerParity/native-uc-signin/index.js";
import { mintUcSessionToken, resolveUcCredential } from "../../open-sse/services/providerParity/native-uc-tts/index.js";

const ENV = Object.freeze({ DURINDOOR_UC_CONSUMER_SIGNIN: "1" });
const EMAIL = "synthetic+uc.contract@example.test";
const CODE = "135790";
const SIGNIN_QS = "?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1"; // emailLogin.ts:44
const MINT_QS = "?_clerk_js_version=5.127.1"; // clerkAuth.ts:95
const FORM_HEADERS = { Origin: "https://uncensored.com", Referer: "https://uncensored.com/", "Content-Type": "application/x-www-form-urlencoded" };

const A = { uid: "5f0c3a1e-1111-4111-8111-00000000000a", sid: "sess_CONTRACTa", sia: "sia_CONTRACTa", idn: "idn_CONTRACTa", pre: "SYNTHETIC-pre-client-a", client: "SYNTHETIC-signed-client-a", cf: "SYNTHETIC-cfbm-a" };
const B = { uid: "5f0c3a1e-1111-4111-8111-00000000000b", sid: "sess_CONTRACTb", sia: "sia_CONTRACTb", idn: "idn_CONTRACTb", pre: "SYNTHETIC-pre-client-b", client: "SYNTHETIC-signed-client-b", cf: "SYNTHETIC-cfbm-b" };

let clock = 1_800_000_000_000;
const now = () => clock;
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** Capture-shaped Clerk session JWT (clerkAuth.ts:4-6, credentials.ts:12-15). */
const sessionJwt = (claims) => `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.SYNTHETICsignature`;
const iat = () => Math.floor(clock / 1000);
const sourceClaims = (account, extra = {}) => ({ iss: "https://clerk.uncensored.com", iat: iat(), exp: iat() + 60, uid: account.uid, ...extra });

const reply = (status, body, cookies = []) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: new Headers([["content-type", "application/json"], ...cookies.map((c) => ["set-cookie", c])]) });

function recorder(routes) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    const { pathname } = new URL(url);
    calls.push({ url, path: pathname, method: init.method, headers: init.headers, body: init.body });
    const handler = routes[`${init.method} ${pathname}`];
    if (!handler) throw new Error(`unexpected ${init.method} ${pathname}`);
    return handler({ body: init.body, headers: init.headers });
  });
  return { fetchImpl, calls };
}

/** Source-shaped Clerk answers for one account (emailLogin.ts:11-28). */
const sourceRoutes = (account, overrides = {}) => ({
  "POST /v1/client/sign_ins": () => reply(200, {
    response: { object: "sign_in_attempt", id: account.sia, status: "needs_first_factor", supported_first_factors: [{ strategy: "email_code", email_address_id: account.idn }] },
  }, [`__client=${account.pre}; Path=/; Domain=.uncensored.com; HttpOnly; Secure`, `__cf_bm=${account.cf}; Path=/; Domain=.uncensored.com`]),
  [`POST /v1/client/sign_ins/${account.sia}/prepare_first_factor`]: () => reply(200, undefined, ["__cf_bm=SYNTHETIC-prepare-rotation; Domain=.uncensored.com"]),
  [`POST /v1/client/sign_ins/${account.sia}/attempt_first_factor`]: () => reply(200, {
    response: { status: "complete", created_session_id: account.sid },
    client: { sessions: [{ id: account.sid, user: { id: account.uid } }] },
  }, [`__client=${account.client}; Path=/; Domain=.uncensored.com; HttpOnly; Secure`, "__client_uat=1800000000; Path=/; Domain=uncensored.com"]),
  [`POST /v1/client/sessions/${account.sid}/tokens`]: () => reply(200, { object: "token", jwt: sessionJwt(sourceClaims(account)) }),
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clock = 1_800_000_000_000;
});

describe("constants (constants.ts)", () => {
  it("pins host, origin, Clerk versions and the refresh skew", () => {
    expect(UC_CLERK_FAPI).toBe("https://clerk.uncensored.com"); // :14
    expect(UC_CLERK_JS_VERSION).toBe("5.127.1"); // :17
    expect(UC_CLERK_API_VERSION).toBe("2025-11-10"); // :20
    expect(UC_APP_ORIGIN).toBe("https://uncensored.com"); // :23
    expect(UC_REFRESH_SKEW_DEFAULT_MS).toBe(8_000); // :36 UC_TOKEN_REFRESH_SKEW_S = 8
  });
});

describe("email-code sign-in wire (emailLogin.ts)", () => {
  it("sends the three source requests byte for byte, in order", async () => {
    const t = recorder(sourceRoutes(A));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const started = await controller.start({ email: EMAIL, consent: true });
    expect(started.ok).toBe(true);
    const done = await controller.verify({ flowId: started.flowId, code: CODE });
    expect(done.ok).toBe(true);

    const [create, prepare, attempt, mint] = t.calls;
    // Step 1 (:130-135): no Cookie, locale before identifier, encodeURIComponent value.
    expect(create.url).toBe(`https://clerk.uncensored.com/v1/client/sign_ins${SIGNIN_QS}`);
    expect(create.method).toBe("POST");
    expect(create.headers).toEqual(FORM_HEADERS);
    expect(Object.keys(create.headers)).toEqual(["Origin", "Referer", "Content-Type"]);
    expect(create.body).toBe(`locale=en-CA&identifier=${encodeURIComponent(EMAIL)}`);
    expect(create.body).toBe("locale=en-CA&identifier=synthetic%2Buc.contract%40example.test");

    // Step 2 (:186-194): email_address_id before strategy; Cookie = step-1 jar (:140-143, :190).
    expect(prepare.url).toBe(`https://clerk.uncensored.com/v1/client/sign_ins/${A.sia}/prepare_first_factor${SIGNIN_QS}`);
    expect(prepare.body).toBe(`email_address_id=${A.idn}&strategy=email_code`);
    expect(prepare.headers).toEqual({ ...FORM_HEADERS, Cookie: `__client=${A.pre}; __cf_bm=${A.cf}` });

    // Step 3 (:229-237): strategy before code; Cookie = the step-1 jar, not the prepare Set-Cookie.
    expect(attempt.url).toBe(`https://clerk.uncensored.com/v1/client/sign_ins/${A.sia}/attempt_first_factor${SIGNIN_QS}`);
    expect(attempt.body).toBe(`strategy=email_code&code=${CODE}`);
    expect(attempt.headers).toEqual({ ...FORM_HEADERS, Cookie: `__client=${A.pre}; __cf_bm=${A.cf}` });
    expect(attempt.headers.Cookie).not.toContain("SYNTHETIC-prepare-rotation");

    // Fork proof mint (clerkAuth.ts:95-108) with the attempt Set-Cookie jar.
    expect(mint.url).toBe(`https://clerk.uncensored.com/v1/client/sessions/${A.sid}/tokens${MINT_QS}`);
    expect(mint.body).toBe("");
    expect(mint.headers).toEqual({ ...FORM_HEADERS, Cookie: `__client=${A.client}; __client_uat=1800000000` });
    expect(t.calls).toHaveLength(4);
  });

  it("harvests the credential the source harvests (:287, :302)", async () => {
    const t = recorder(sourceRoutes(A));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    const done = await controller.verify({ flowId, code: CODE });
    // clientCookie = attempt Set-Cookie __client (not the step-1 one), sid = created_session_id,
    // uid = client.sessions[sid].user.id, cookies = attempt Set-Cookie jar.
    expect(done.providerSpecificData).toEqual({
      ucClientCookie: A.client,
      ucSid: A.sid,
      ucUid: A.uid,
      ucCookies: { __client: A.client, __client_uat: "1800000000" },
      ucAuthSource: "email-code",
      ucSignedInAt: new Date(clock).toISOString(),
    });
    expect(JSON.stringify(done)).not.toContain(A.pre);
    expect(JSON.stringify(done)).not.toContain(A.cf);
  });

  it("proceeds when step 1 sets no cookie and prepare answers 200 with an empty body", async () => {
    const t = recorder(sourceRoutes(A, {
      "POST /v1/client/sign_ins": () => reply(200, { response: { id: A.sia, status: "needs_first_factor", supported_first_factors: [{ strategy: "email_code", email_address_id: A.idn }] } }),
      [`POST /v1/client/sign_ins/${A.sia}/prepare_first_factor`]: () => new Response("", { status: 200 }),
    }));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const started = await controller.start({ email: EMAIL, consent: true });
    expect(started).toMatchObject({ ok: true, state: "code_sent" });
    expect(t.calls[1].headers).not.toHaveProperty("Cookie");
    const done = await controller.verify({ flowId: started.flowId, code: CODE });
    expect(done).toMatchObject({ ok: true, providerSpecificData: { ucUid: A.uid, ucClientCookie: A.client } });
    expect(t.calls[2].headers).not.toHaveProperty("Cookie");
  });

  it("accepts a bare (unwrapped) Clerk body like the source's clerkResponse (:112-115)", async () => {
    const t = recorder(sourceRoutes(A, {
      "POST /v1/client/sign_ins": () => reply(200, { id: A.sia, status: "needs_first_factor", supported_first_factors: [{ strategy: "email_code", email_address_id: A.idn }] }, [`__client=${A.pre}; Domain=.uncensored.com`]),
    }));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    expect(await controller.start({ email: EMAIL, consent: true })).toMatchObject({ ok: true });
  });

  it("refuses an attempt answer whose Set-Cookie has no __client, even when step 1 set one (:287-294)", async () => {
    const t = recorder(sourceRoutes(A, {
      [`POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`]: () => reply(200, {
        response: { status: "complete", created_session_id: A.sid },
        client: { sessions: [{ id: A.sid, user: { id: A.uid } }] },
      }, ["__client_uat=1800000000; Domain=uncensored.com"]),
    }));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    const result = await controller.verify({ flowId, code: CODE });
    expect(result).toMatchObject({ ok: false, kind: "malformed" });
    expect(result).not.toHaveProperty("providerSpecificData");
    expect(t.calls.some((c) => c.path.includes("/sessions/"))).toBe(false);
  });

  it("takes the uid only from the created session; no sessions[0] fallback (fork, account isolation)", async () => {
    const t = recorder(sourceRoutes(A, {
      [`POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`]: () => reply(200, {
        response: { status: "complete", created_session_id: A.sid },
        client: { sessions: [{ id: B.sid, user: { id: B.uid } }, { id: A.sid, user: { id: A.uid } }] },
      }, [`__client=${A.client}; Domain=.uncensored.com`]),
    }));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    expect((await controller.verify({ flowId, code: CODE })).providerSpecificData.ucUid).toBe(A.uid);

    const other = recorder(sourceRoutes(A, {
      [`POST /v1/client/sign_ins/${A.sia}/attempt_first_factor`]: () => reply(200, {
        response: { status: "complete", created_session_id: A.sid },
        client: { sessions: [{ id: B.sid, user: { id: B.uid } }] },
      }, [`__client=${A.client}; Domain=.uncensored.com`]),
    }));
    const c2 = createUcSignInController({ fetchImpl: other.fetchImpl, env: ENV, now });
    const f2 = await c2.start({ email: EMAIL, consent: true });
    expect(await c2.verify({ flowId: f2.flowId, code: CODE })).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("does not require a JWT uid claim; refuses one that names another account or session", async () => {
    const run = async (claims) => {
      const t = recorder(sourceRoutes(A, { [`POST /v1/client/sessions/${A.sid}/tokens`]: () => reply(200, { object: "token", jwt: sessionJwt(claims) }) }));
      const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
      const { flowId } = await controller.start({ email: EMAIL, consent: true });
      return controller.verify({ flowId, code: CODE });
    };
    const { uid: _uid, ...noUid } = sourceClaims(A);
    expect(await run(noUid)).toMatchObject({ ok: true, providerSpecificData: { ucUid: A.uid } });
    expect(await run(sourceClaims(A, { sid: A.sid }))).toMatchObject({ ok: true });
    expect(await run(sourceClaims(B))).toMatchObject({ ok: false, kind: "identity" });
    expect(await run(sourceClaims(A, { sid: B.sid }))).toMatchObject({ ok: false, kind: "identity" });
  });
});

describe("session token mint (clerkAuth.ts)", () => {
  const routes = (account, mint) => ({ [`POST /v1/client/sessions/${account.sid}/tokens`]: mint ?? (() => reply(200, { object: "token", jwt: sessionJwt(sourceClaims(account)) })) });
  const creds = (account, extra = {}) => ({ providerSpecificData: { ucClientCookie: account.client, ucSid: account.sid, ucUid: account.uid, ucCookies: { __client: account.client, __cf_bm: account.cf }, ...extra } });

  it("sends the source mint request (:95-108)", async () => {
    const t = recorder(routes(A));
    const result = await mintUcSession(t.fetchImpl, { sid: A.sid, cookies: { __client: A.client, __cf_bm: A.cf }, expectedUid: A.uid });
    expect(result).toMatchObject({ ok: true, uid: A.uid, expiresAt: (iat() + 60) * 1000 });
    expect(t.calls).toEqual([{
      url: `https://clerk.uncensored.com/v1/client/sessions/${A.sid}/tokens${MINT_QS}`,
      path: `/v1/client/sessions/${A.sid}/tokens`,
      method: "POST",
      headers: { ...FORM_HEADERS, Cookie: `__client=${A.client}; __cf_bm=${A.cf}` },
      body: "",
    }]);
    expect(t.calls[0].url).not.toContain("__clerk_api_version");
  });

  it("reads top-level `jwt`, else top-level `token`, and nothing else (:128-131)", async () => {
    const jwt = sessionJwt(sourceClaims(A));
    for (const [body, ok] of [[{ object: "token", jwt }, true], [{ token: jwt }, true], [{ response: { jwt } }, false], [{ jwt: 42 }, false]]) {
      const t = recorder(routes(A, () => reply(200, body)));
      const result = await mintUcSession(t.fetchImpl, { sid: A.sid, cookies: { __client: A.client }, expectedUid: A.uid });
      expect(result.ok).toBe(ok);
      if (!ok) expect(result.kind).toBe("malformed");
    }
  });

  it("caches per account and re-mints 8 s before exp (:156-180, constants.ts:36)", async () => {
    const t = recorder(routes(A));
    const controller = createUcSessionController({ fetchImpl: t.fetchImpl, env: ENV, now });
    await controller.getSessionToken(creds(A));
    clock += 51_999; // 8.001 s left
    expect(await controller.getSessionToken(creds(A))).toMatchObject({ cached: true });
    clock += 1; // 8 s left: inside the skew
    expect(await controller.getSessionToken(creds(A))).toMatchObject({ cached: false });
    expect(t.calls).toHaveLength(2);
  });

  it("treats 401 and 403 as an invalid durable login and evicts the cache (:85-87)", async () => {
    for (const status of [401, 403]) {
      let revoked = false;
      const t = recorder(routes(A, () => (revoked ? reply(status, {}) : reply(200, { jwt: sessionJwt(sourceClaims(A)) }))));
      const controller = createUcSessionController({ fetchImpl: t.fetchImpl, env: ENV, now });
      await controller.getSessionToken(creds(A));
      revoked = true;
      clock += 55_000;
      expect(await controller.getSessionToken(creds(A))).toMatchObject({ ok: false, kind: "reauth", httpStatus: 401 });
      expect(controller.cachedAccounts).toBe(0);
    }
  });

  it("hands back a Set-Cookie rotation for the same connection only (:22-24, :115)", async () => {
    const t = recorder({
      ...routes(A, () => reply(200, { jwt: sessionJwt(sourceClaims(A)) }, ["__client=SYNTHETIC-rotated-a; Domain=.uncensored.com", "__cf_bm=SYNTHETIC-cf-rotated; Domain=.uncensored.com"])),
      ...routes(B),
    });
    const controller = createUcSessionController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const a = await controller.getSessionToken(creds(A));
    expect(a.rotated).toEqual({ ucClientCookie: "SYNTHETIC-rotated-a", ucCookies: { __client: "SYNTHETIC-rotated-a", __cf_bm: "SYNTHETIC-cf-rotated" } });
    const b = await controller.getSessionToken(creds(B));
    expect(b.rotated).toBeNull();
    expect(t.calls[1].headers.Cookie).toBe(`__client=${B.client}; __cf_bm=${B.cf}`);
  });

  it("accepts a token without a uid claim and refuses a foreign uid or sid claim", async () => {
    const { uid: _uid, ...noUid } = sourceClaims(A);
    for (const [claims, expected] of [
      [noUid, { ok: true }],
      [sourceClaims(A, { sid: A.sid }), { ok: true }],
      [sourceClaims(B), { ok: false, kind: "identity" }],
      [sourceClaims(A, { sid: B.sid }), { ok: false, kind: "identity" }],
    ]) {
      const t = recorder(routes(A, () => reply(200, { jwt: sessionJwt(claims) })));
      const controller = createUcSessionController({ fetchImpl: t.fetchImpl, env: ENV, now });
      expect(await controller.getSessionToken(creds(A))).toMatchObject(expected);
    }
  });

  it("exposes no session touch: the pinned source has none", () => {
    expect(signinModule).not.toHaveProperty("touchUcSession");
    const controller = createUcSessionController({ fetchImpl: vi.fn(), env: ENV, now });
    expect(controller).not.toHaveProperty("touch");
  });
});

describe("staged TTS compatibility (credentials.ts:110-125)", () => {
  it("signed-in metadata resolves and mints through the real staged TTS path, with and without a uid claim", async () => {
    const t = recorder(sourceRoutes(A));
    const controller = createUcSignInController({ fetchImpl: t.fetchImpl, env: ENV, now });
    const { flowId } = await controller.start({ email: EMAIL, consent: true });
    const { providerSpecificData } = await controller.verify({ flowId, code: CODE });
    const credential = resolveUcCredential({ providerSpecificData });
    expect(credential).toEqual({ clientCookie: A.client, sid: A.sid, uid: A.uid, cookies: { __client: A.client, __client_uat: "1800000000" } });

    const { uid: _uid, ...noUid } = sourceClaims(A);
    for (const claims of [sourceClaims(A), noUid]) {
      const jwt = sessionJwt(claims);
      const ttsFetch = vi.fn(async () => reply(200, { object: "token", jwt }));
      vi.stubGlobal("fetch", ttsFetch);
      expect(await mintUcSessionToken(credential)).toEqual({ ok: true, jwt });
      expect(ttsFetch.mock.calls[0][0]).toBe(`https://clerk.uncensored.com/v1/client/sessions/${A.sid}/tokens${MINT_QS}`);
      expect(ttsFetch.mock.calls[0][1].headers.Cookie).toBe(`__client=${A.client}; __client_uat=1800000000`);
    }
  });
});

describe("cookie import (credentials.ts:110-125, clerkAuth.ts:89-154)", () => {
  const fields = { ucClientCookie: A.client, ucSid: A.sid, ucUid: A.uid, ucCookies: { __cf_bm: A.cf } };
  const run = (claims) => {
    const t = recorder({ [`POST /v1/client/sessions/${A.sid}/tokens`]: () => reply(200, { jwt: sessionJwt(claims) }) });
    return importUcCookies({ consent: true, fields }, { fetchImpl: t.fetchImpl, env: ENV, now });
  };

  it("saves a pasted credential whose minted JWT names the same uid, or carries no uid claim", async () => {
    const { uid: _uid, ...noUid } = sourceClaims(A);
    expect(await run(sourceClaims(A))).toMatchObject({ ok: true, providerSpecificData: { ucUid: A.uid, ucSid: A.sid, ucAuthSource: "cookie-import" } });
    expect(await run(noUid)).toMatchObject({ ok: true, providerSpecificData: { ucUid: A.uid } });
  });

  it("never saves a pasted credential whose JWT names another account or session", async () => {
    for (const claims of [sourceClaims(B), sourceClaims(A, { sid: B.sid }), { iat: iat(), exp: iat() + 60, sid: B.sid }]) {
      const result = await run(claims);
      expect(result).toMatchObject({ ok: false, kind: "identity" });
      expect(result).not.toHaveProperty("providerSpecificData");
    }
  });
});
