import { describe, it, expect, vi } from "vitest";
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { normalizeMaxaiSession, exportMaxaiSession, renewMaxaiSession } from "../../open-sse/services/providerParity/native-maxai-session/index.js";
import { signMaxaiRefresh, MAXAI_REFRESH_PATH } from "../../open-sse/services/providerParity/native-maxai-session/renew.js";

const jwt = (user, exp) => `e30.${Buffer.from(JSON.stringify({ subject: { user_id: user }, exp })).toString("base64url")}.synthetic`;
const session = (user = "A") => ({ accessToken: jwt(user, 2000000000), refreshToken: jwt(user, 2100000000), deviceId: `device-${user}`, userId: user });
const constants = { aesKey: "synthetic-aes", hmacKey: "synthetic-hmac", appVersion: "webpage_1.2.3", ctxKey: "c".repeat(40) };
const reply = (token = jwt("A", 2000000123)) => new Response(JSON.stringify({ data: { access_token: token } }));
const renew = (extra = {}) => renewMaxaiSession({ credentials: session(), constants, fetchImpl: vi.fn(async () => reply()), ...extra });

function open(blob) {
  const bytes = Buffer.from(blob, "base64");
  const salt = bytes.subarray(8, 16);
  let block = Buffer.alloc(0), derived = Buffer.alloc(0);
  while (derived.length < 48) {
    block = createHash("md5").update(Buffer.concat([block, Buffer.from(constants.aesKey), salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  const cipher = createDecipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 48));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(16)), cipher.final()]).toString());
}

describe("private MaxAI source session", () => {
  it("imports complete source objects, JWT subject and quoted device; round-trips explicit secret export", () => {
    const input = { ...session(), deviceId: '"device-A"', userId: undefined };
    const result = normalizeMaxaiSession(JSON.stringify(input));
    expect(result).toEqual({ ok: true, ...session(), expiresAt: 2000000000 });
    expect(normalizeMaxaiSession(exportMaxaiSession(input).json)).toEqual(result);
    expect(normalizeMaxaiSession({ access_token: session().accessToken, refresh_token: session().refreshToken, deviceId: "device-A", user_id: "A" })).toEqual(result);
  });
  it("migrates source connection exports and honors canonical top-level refresh", () => {
    const a = session();
    const input = { apiKey: a.accessToken, refreshToken: a.refreshToken,
      providerSpecificData: { maxaiAccessToken: a.accessToken, maxaiDeviceId: a.deviceId, maxaiUserId: a.userId, maxaiRefreshToken: "stale" } };
    expect(normalizeMaxaiSession(input)).toEqual({ ok: true, ...a, expiresAt: 2000000000 });
    delete input.refreshToken;
    expect(normalizeMaxaiSession(input).refreshToken).toBe("stale");
    input.refreshToken = "";
    expect(normalizeMaxaiSession(input).ok).toBe(false);
  });
  it.each([
    null, [], "not JSON", "access_token=x; device_id=d; user_id=u",
    { ...session(), cookie: "guessed=x" }, { ...session(), access_token: "different" },
    { ...session(), deviceId: "" }, { ...session(), userId: "B" },
    { ...session(), refreshToken: jwt("B", 2100000000) },
    { ...session(), deviceId: "d\r\nsecret" }, { ...session(), accessToken: "s".repeat(8193) },
    { providerSpecificData: { maxaiAccessToken: "x", deviceId: "d", userId: "u" } },
    { ...session(), providerSpecificData: { maxaiAccessToken: "other", maxaiDeviceId: "d", maxaiUserId: "A" } },
  ])("refuses incomplete, unsafe or conflicting input without values (%#)", (input) => {
    expect(normalizeMaxaiSession(input)).toEqual({ ok: false, status: 0, error: "invalid_session" });
  });
  it("does not fabricate expiry or carry old expiry into renewed opaque tokens", async () => {
    expect(normalizeMaxaiSession({ ...session(), accessToken: "opaque" })).not.toHaveProperty("expiresAt");
    expect(await renew({ fetchImpl: async () => reply("new-opaque") })).not.toHaveProperty("expiresAt");
  });
  it("matches the pinned refresh signature formula and source payload", () => {
    const headers = signMaxaiRefresh(session(), constants, { now: () => 1234567890000, random: () => "123456", salt: Buffer.alloc(8, 1) });
    const payload = open(headers["X-Authorization"]);
    const sha = createHmac("sha1", `1234567890000:${constants.hmacKey}`)
      .update(`${constants.appVersion}:1234567890000:${MAXAI_REFRESH_PATH}:A`).digest("hex");
    expect(payload).toEqual({ "X-Client-Domain": "maxai.co", "X-Client-Path": "https://www.maxai.co/app/", "X-Random": "123456",
      t: 1234567890000, p: createHash("sm3").update(`1234567890000:${sha}:${constants.hmacKey}`).digest("hex"), d: "device-A", [constants.ctxKey]: { a: "" } });
  });
  it("submits exactly the source renewal wire contract and returns provider expiry", async () => {
    const fetchImpl = vi.fn(async () => reply());
    const result = await renew({ fetchImpl });
    expect(result).toEqual({ ok: true, status: 200, ...session(), accessToken: jwt("A", 2000000123), expiresAt: 2000000123 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init, route] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.maxai.me/oauth/refresh_access_token");
    expect(init).toMatchObject({ method: "POST", body: '{"app":"maxai_webapp"}', redirect: "manual", credentials: "omit", noTransportReplay: true });
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${session().refreshToken}`, noAuthLogout: "true", Origin: "https://www.maxai.co" });
    expect(open(init.headers["X-Authorization"]).d).toBe("device-A");
    expect(route).toMatchObject({ disableEnvProxy: true, strictProxy: true });
  });
  it("keeps two concurrent accounts and proxy snapshots independent", async () => {
    const a = session(), b = session("B"), route = { enabled: true, url: "http://proxy-a.invalid:8080" };
    const calls = [];
    const fetchImpl = async (url, init, proxy) => {
      calls.push({ url, init, proxy });
      return reply(init.headers.Authorization.includes(b.refreshToken) ? jwt("B", 2000000123) : jwt("A", 2000000123));
    };
    const first = renew({ credentials: a, proxyOptions: route, fetchImpl });
    a.deviceId = "mutated"; route.url = "http://mutated.invalid";
    const second = renew({ credentials: b, proxyOptions: { enabled: true, url: "http://proxy-b.invalid:8080" }, fetchImpl });
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.userId)).toEqual(["A", "B"]);
    expect(calls.map((c) => open(c.init.headers["X-Authorization"]).d)).toEqual(["device-A", "device-B"]);
    expect(calls.map((c) => c.proxy.connectionProxyUrl)).toEqual(["http://proxy-a.invalid:8080", "http://proxy-b.invalid:8080"]);
    expect(session().accessToken).not.toBe(results[0].accessToken);
  });
  it.each([401, 403, 418, 500])("returns safe rejection %s without upstream secrets", async (status) => {
    expect(await renew({ fetchImpl: async () => new Response(session().refreshToken, { status }) }))
      .toEqual({ ok: false, status, error: "refresh_rejected" });
  });
  it.each(["bad json", "{}", '{"data":{"access_token":4}}', JSON.stringify({ data: { access_token: jwt("B", 2100000000) } }),
    JSON.stringify({ data: { access_token: "a" }, access_token: "b" }), "x".repeat(65537)])("rejects malformed response (%#)", async (raw) => {
    expect(await renew({ fetchImpl: async () => new Response(raw) })).toEqual({ ok: false, status: 200, error: "invalid_response" });
  });
  it("accepts the source top-level access_token response variant", async () => {
    expect((await renew({ fetchImpl: async () => new Response('{"access_token":"opaque"}') })).accessToken).toBe("opaque");
  });
  it.each([302, 307, 308])("refuses redirects without following (%s)", async (status) => {
    const send = vi.fn(async () => new Response(null, { status, headers: { Location: "https://evil.invalid" } }));
    expect((await renew({ fetchImpl: send })).error).toBe("redirect_refused");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("refuses followed/off-origin replies and caller endpoint overrides", async () => {
    const res = reply(); Object.defineProperty(res, "url", { value: "https://evil.invalid/" });
    expect((await renew({ fetchImpl: async () => res })).error).toBe("redirect_refused");
    const send = vi.fn();
    expect((await renew({ fetchImpl: send, origin: "https://evil.invalid" })).error).toBe("invalid_options");
    expect((await renew({ fetchImpl: send, proxyOptions: { vercelRelayUrl: "https://evil.invalid" } })).error).toBe("invalid_options");
    expect(send).not.toHaveBeenCalled();
  });
  it("bounds stalled submit and body and respects cancellation", async () => {
    expect((await renew({ timeoutMs: 20, fetchImpl: () => new Promise(() => {}) })).error).toBe("deadline_exceeded");
    const cancelled = vi.fn();
    expect((await renew({ timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ cancel: cancelled })) })).ok).toBe(false);
    expect(cancelled).toHaveBeenCalled();
    const controller = new AbortController(), send = vi.fn(); controller.abort();
    expect((await renew({ signal: controller.signal, fetchImpl: send })).error).toBe("cancelled");
    expect(send).not.toHaveBeenCalled();
    const active = new AbortController();
    const pending = renew({ signal: active.signal, fetchImpl: () => new Promise(() => {}) });
    active.abort(new Error(session().refreshToken));
    expect(await pending).toEqual({ ok: false, status: 0, error: "cancelled" });
  });
  it("does not leak transport messages or log secrets", async () => {
    const spies = ["log", "warn", "error", "info"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
    try {
      expect(await renew({ fetchImpl: async () => { throw new Error(session().refreshToken); } })).toEqual({ ok: false, status: 0, error: "refresh_failed" });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { spies.forEach((spy) => spy.mockRestore()); }
  });
  it("refuses unusable credentials, constants and routes before any submit", async () => {
    const send = vi.fn();
    for (const extra of [
      { credentials: { ...session(), refreshToken: undefined } }, { constants: {} },
      { proxyOptions: { enabled: true, url: "invalid" } },
      { timeoutMs: Infinity }, { timeoutMs: 30001 },
    ]) {
      expect((await renew({ fetchImpl: send, ...extra })).ok).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });
  it("aborts before submit and discards a response delivered after the deadline", async () => {
    const controller = new AbortController(); controller.abort();
    const send = vi.fn();
    expect((await renew({ signal: controller.signal, fetchImpl: send })).error).toBe("cancelled");
    expect(send).not.toHaveBeenCalled();
    let deliver;
    const cancel = vi.fn();
    const res = new Response(new ReadableStream({ cancel }));
    const result = await renew({ timeoutMs: 10, fetchImpl: () => new Promise((resolve) => { deliver = resolve; }) });
    expect(result.error).toBe("deadline_exceeded");
    deliver(res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalled();
  });
});
