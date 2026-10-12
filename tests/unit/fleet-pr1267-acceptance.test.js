// #1088 acceptance: credential-bearing errors on the real proxy entry point and the
// real passToken exchange must not reach captured logs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dashboardProxy = vi.hoisted(() => vi.fn(async () => new Response("dashboard", { status: 200 })));
const canAccessManagementApi = vi.hoisted(() => vi.fn(async () => true));
const proxyAccountRequest = vi.hoisted(() => vi.fn());
vi.mock("../../src/dashboardGuard", () => ({ proxy: dashboardProxy, canAccessManagementApi }));
vi.mock("../../src/lib/mimoLoginSession", async (importOriginal) => ({ ...(await importOriginal()), proxyAccountRequest }));

import proxy from "../../src/proxy.js";
import { SESSION_COOKIE, beginSession, encodeSessionCookie } from "../../src/lib/mimoLoginSession.js";
import { getMimoAccountCookie } from "../../open-sse/shared/mimoAccount.js";

const SECRET = {
  token: "FLEET_TOKEN_1088",
  cookie: "FLEET_COOKIE_1088",
  code: "FLEET_AUTHCODE_1088",
};
let logs;

beforeEach(() => {
  logs = [];
  for (const m of ["log", "warn", "error", "info", "debug"]) {
    vi.spyOn(console, m).mockImplementation((...a) => logs.push(a));
  }
  proxyAccountRequest.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectNoSecrets() {
  const captured = JSON.stringify(logs.map((a) => a.map(String)));
  for (const s of Object.values(SECRET)) expect(captured).not.toContain(s);
}

function request(pathname, cookieValue) {
  return {
    url: `http://localhost:20128${pathname}`,
    method: "GET",
    headers: new Headers({ host: "localhost:20128", cookie: `${SESSION_COOKIE}=${cookieValue}` }),
    nextUrl: { pathname, search: "", protocol: "http:" },
    cookies: { get: (n) => (n === SESSION_COOKIE ? { value: cookieValue } : undefined) },
  };
}

describe("MiMo login credential redaction acceptance (#1088)", () => {
  it("proxy entry point does not log credential-bearing proxy errors and returns 502", async () => {
    proxyAccountRequest.mockRejectedValueOnce(new Error(
      `fetch failed https://account.xiaomi.com/pass?code=${SECRET.code}; Cookie: passToken=${SECRET.token}; ${SECRET.cookie}`,
    ));
    const res = await proxy(request("/fe/service/login", encodeSessionCookie(beginSession("sgp"))));
    expect(res.status).toBe(502);
    expect(logs).not.toEqual([]); // still diagnosable
    expectNoSecrets();
  });

  it("passToken exchange does not log upstream response bodies on handshake failure", async () => {
    const body = JSON.stringify({
      code: 70016, location: `https://x/?code=${SECRET.code}`, passToken: SECRET.token, cookie: SECRET.cookie,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const result = await getMimoAccountCookie({
      region: "sgp", mimoPassToken: `${crypto.randomUUID()}-${SECRET.token}`, mimoUserId: "1", mimoCUserId: "2",
    });
    expect(result).toBeNull();
    expectNoSecrets();
  });

  it("passToken exchange does not log credential-bearing transport exception messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`connect failed https://account.xiaomi.com/pass?code=${SECRET.code} Cookie: ${SECRET.cookie}`);
    }));
    const result = await getMimoAccountCookie({
      region: "sgp", mimoPassToken: `${crypto.randomUUID()}-${SECRET.token}`, mimoUserId: "1", mimoCUserId: "2",
    });
    expect(result).toBeNull();
    expectNoSecrets();
  });
});
