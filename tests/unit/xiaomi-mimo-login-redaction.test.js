import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSession,
  ensureServiceSession,
  loginUpstreamFetch,
  proxyAccountRequest,
  runTakeover,
} from "../../src/lib/mimoLoginSession.js";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), proxyFetch: vi.fn() }));
vi.mock("../../open-sse/shared/mimoAccount.js", () => ({ getMimoAccountCookie: mocks.exchange }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyFetch }));

const ORIGIN = "https://dashboard.example.test";
const SECRET = {
  passToken: "SYNTH_PASS_1088",
  serviceToken: "SYNTH_SERVICE_1088",
  cookie: "SYNTH_COOKIE_1088",
  code: "SYNTH_CODE_1088",
  proxyUser: "SYNTH_PROXY_USER_1088",
  proxyPassword: "SYNTH_PROXY_PASSWORD_1088",
};
const PROXY = `http://${SECRET.proxyUser}:${SECRET.proxyPassword}@proxy.example.test:8080`;
let logs;
let fetchMock;

beforeEach(() => {
  mocks.exchange.mockReset();
  mocks.proxyFetch.mockReset();
  logs = [];
  for (const method of ["log", "warn", "error", "info", "debug"]) {
    vi.spyOn(console, method).mockImplementation((...args) => logs.push(args));
  }
  // Unexpected network paths fail locally; no browser, account, or real transport is used.
  fetchMock = vi.fn(() => { throw new Error("Unexpected unmocked fetch"); });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectPrivateDiagnostics(sess, ...safeValues) {
  expect(logs).not.toEqual([]);
  const captured = JSON.stringify(logs);
  // State authorizes credential release; it is never a diagnostic identifier.
  for (const secret of [sess.state, ...Object.values(SECRET), ...[...sess.jar.values()].map((c) => c.value)]) {
    expect.soft(captured).not.toContain(secret);
  }
  const diagnostics = logs.map((args) => args.find((arg) => arg && typeof arg === "object" && "correlation" in arg));
  for (const details of diagnostics) {
    expect(details).toEqual(expect.objectContaining({ correlation: expect.any(String) }));
    expect(details.correlation).not.toBe("");
    expect(details.correlation).not.toBe(sess.state);
  }
  expect(new Set(diagnostics.map((details) => details.correlation)).size).toBe(1);
  // Keep diagnostics useful without prescribing console argument order.
  for (const value of safeValues) {
    expect.soft(captured).toContain(String(value));
  }
  return diagnostics;
}

function identitySession() {
  const sess = beginSession("sgp");
  sess.jar.set("passToken|account.xiaomi.com|/", {
    // Unique prefix prevents module-level exchange backoff from skipping later cases.
    name: "passToken", value: `${crypto.randomUUID()}:${SECRET.passToken}`, domain: "account.xiaomi.com", path: "/",
  });
  return sess;
}

describe("MiMo login diagnostics privacy (#1088)", () => {
  it("correlates repeated events per session without exposing credential-release state", async () => {
    const first = identitySession();
    const second = identitySession();
    const correlations = [];
    for (const sess of [first, second, first]) {
      logs = [];
      const response = await runTakeover(sess,
        `${sess.upstreamBase}/api/sts?code=${SECRET.code}`, ORIGIN);
      expect(response.status).toBe(200);
      expect(sess.status).toBe("done");
      const diagnostics = expectPrivateDiagnostics(sess);
      correlations.push(diagnostics[0].correlation);
      for (const state of [first.state, second.state]) {
        expect(JSON.stringify(logs)).not.toContain(state);
        expect(diagnostics[0].correlation).not.toBe(state);
      }
    }
    expect(correlations[0]).toBe(correlations[2]);
    expect(correlations[0]).not.toBe(correlations[1]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps upstream status, numeric failure code and correlation without logging URL or body credentials", async () => {
    const sess = beginSession("sgp");
    const body = JSON.stringify({
      code: 10025, passToken: SECRET.passToken, serviceToken: SECRET.serviceToken,
      cookie: SECRET.cookie, authorization_code: SECRET.code,
    });
    fetchMock.mockResolvedValueOnce(new Response(body, {
      status: 401, headers: { "content-type": "application/json" },
    }));
    const response = await proxyAccountRequest(sess,
      new Request(`${ORIGIN}/pass/serviceLogin?code=${SECRET.code}`), ORIGIN);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(JSON.parse(body));
    expect(expectPrivateDiagnostics(sess, 401, 10025)).toContainEqual(
      expect.objectContaining({ status: 401, upstreamCode: 10025 }),
    );
  });

  it("does not log callback authorization codes during takeover", async () => {
    const sess = identitySession();
    const response = await runTakeover(sess,
      `${sess.upstreamBase}/api/sts?code=${SECRET.code}&serviceToken=${SECRET.serviceToken}`, ORIGIN);
    expect(response.status).toBe(200);
    expect(sess.status).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled();
    expectPrivateDiagnostics(sess);
  });

  it("does not log unmatched local callback request bodies", async () => {
    const sess = beginSession("sgp");
    fetchMock.mockResolvedValueOnce(new Response("ok", { headers: { "content-type": "text/plain" } }));
    const response = await proxyAccountRequest(sess, new Request(`${ORIGIN}/pass/serviceLoginAuth2`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback: "http://localhost/unmatched", cookie: SECRET.cookie, code: SECRET.code }),
    }), ORIGIN);
    expect(await response.text()).toBe("ok");
    expectPrivateDiagnostics(sess);
  });

  it("does not log proxy userinfo while exchanging a captured passToken", async () => {
    const sess = identitySession();
    sess.proxyUrl = PROXY;
    mocks.exchange.mockResolvedValueOnce(`serviceToken=${SECRET.serviceToken}`);
    mocks.proxyFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await ensureServiceSession(sess)).toBe(true);
    expect(expectPrivateDiagnostics(sess, 200)).toContainEqual(expect.objectContaining({ status: 200 }));
  });

  it("keeps safe exchange failure codes without echoing credential-bearing exception messages", async () => {
    const sess = identitySession();
    mocks.exchange.mockRejectedValueOnce(Object.assign(new Error(
      `ECONNRESET https://account.xiaomi.com/pass?code=${SECRET.code}; Cookie: ${SECRET.cookie}`,
    ), { code: "ECONNRESET" }));
    expect(await ensureServiceSession(sess)).toBe(false);
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
    expect(expectPrivateDiagnostics(sess, "ECONNRESET")).toContainEqual(
      expect.objectContaining({ transportCode: "ECONNRESET" }),
    );
  });

  it("keeps safe proxy failure codes and direct fallback without logging proxy or OAuth credentials", async () => {
    const sess = beginSession("sgp");
    sess.proxyUrl = PROXY;
    mocks.proxyFetch.mockRejectedValueOnce(Object.assign(new Error(
      `ECONNREFUSED ${PROXY}/?code=${SECRET.code}; Cookie: ${SECRET.cookie}`,
    ), { code: "ECONNREFUSED" }));
    fetchMock.mockResolvedValueOnce(new Response("fallback", { status: 200 }));
    const response = await loginUpstreamFetch("https://account.xiaomi.com/pass/login", {}, sess);
    expect(await response.text()).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.proxyFetch).toHaveBeenCalledTimes(1);
    expect(expectPrivateDiagnostics(sess, "ECONNREFUSED")).toContainEqual(
      expect.objectContaining({ transportCode: "ECONNREFUSED" }),
    );
  });

  describe.each(["exchange", "proxy fallback"])("hostile error.code during %s", (path) => {
    it.each(["credential string", "allowlisted prefix", "object", "throwing getter"])(
      "rejects %s without leaking secrets or interrupting failure handling",
      async (kind) => {
        const sess = identitySession();
        sess.proxyUrl = PROXY;
        const payload = `${sess.state} ${PROXY}/?code=${SECRET.code}; Cookie: ${SECRET.cookie}; `
          + `passToken=${SECRET.passToken}; serviceToken=${SECRET.serviceToken}`;
        const error = new Error(payload);
        const coerce = vi.fn(() => { throw new Error(payload); });
        const getter = vi.fn(() => { throw new Error(payload); });
        const hostileCodes = {
          "credential string": payload,
          "allowlisted prefix": `ECONNRESET ${payload}`,
          object: { secret: payload, toString: coerce, toJSON: coerce, [Symbol.toPrimitive]: coerce },
        };
        Object.defineProperty(error, "code", kind === "throwing getter"
          ? { enumerable: true, get: getter }
          : { enumerable: true, value: hostileCodes[kind] });

        if (path === "exchange") {
          mocks.exchange.mockRejectedValueOnce(error);
          expect(await ensureServiceSession(sess)).toBe(false);
          expect(mocks.exchange).toHaveBeenCalledTimes(1);
          expect(mocks.proxyFetch).not.toHaveBeenCalled();
          expect(fetchMock).not.toHaveBeenCalled();
        } else {
          mocks.proxyFetch.mockRejectedValueOnce(error);
          fetchMock.mockResolvedValueOnce(new Response("fallback", { status: 200 }));
          const url = "https://account.xiaomi.com/pass/login";
          const init = { method: "GET" };
          const response = await loginUpstreamFetch(url, init, sess);
          expect(response.status).toBe(200);
          expect(await response.text()).toBe("fallback");
          expect(mocks.proxyFetch).toHaveBeenCalledTimes(1);
          expect(fetchMock).toHaveBeenCalledTimes(1);
          expect(fetchMock).toHaveBeenCalledWith(url, init);
          expect(mocks.exchange).not.toHaveBeenCalled();
        }

        const diagnostics = expectPrivateDiagnostics(sess);
        expect(diagnostics).toContainEqual(expect.objectContaining({
          event: path === "exchange" ? "exchange_error" : "proxy_fetch_direct_fallback",
        }));
        for (const details of diagnostics) {
          expect(details).not.toHaveProperty("transportCode");
        }
        expect(coerce).not.toHaveBeenCalled();
        if (kind === "throwing getter") expect(getter).toHaveBeenCalled();
      },
    );
  });
});
