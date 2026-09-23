// port(upstream): #4245 - the MiMo login proxy branch in src/proxy.js must need dashboard access.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardProxy = vi.hoisted(() => vi.fn(async () => new Response("dashboard", { status: 200 })));
const canAccessManagementApi = vi.hoisted(() => vi.fn());
const proxyAccountRequest = vi.hoisted(() => vi.fn(async () => new Response("xiaomi", { status: 200 })));
vi.mock("../../src/dashboardGuard", () => ({ proxy: dashboardProxy, canAccessManagementApi }));
vi.mock("../../src/lib/mimoLoginSession", async (importOriginal) => ({ ...(await importOriginal()), proxyAccountRequest }));

import proxy from "../../src/proxy.js";
import { SESSION_COOKIE, beginSession, encodeSessionCookie } from "../../src/lib/mimoLoginSession.js";

function request(pathname, cookieValue) {
  const headers = new Headers({ host: "localhost:20128" });
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE}=${cookieValue}`);
  return {
    url: `http://localhost:20128${pathname}`,
    method: "GET",
    headers,
    nextUrl: { pathname, search: "", protocol: "http:" },
    cookies: { get: (name) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined) },
  };
}

describe("MiMo login proxy gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves requests without the session cookie to the dashboard guard", async () => {
    await proxy(request("/fe/service/login"));
    expect(dashboardProxy).toHaveBeenCalledTimes(1);
    expect(canAccessManagementApi).not.toHaveBeenCalled();
  });

  it("clears a session cookie sent without dashboard access and never proxies", async () => {
    canAccessManagementApi.mockResolvedValue(false);
    const res = await proxy(request("/fe/service/login", encodeSessionCookie(beginSession("cn"))));
    expect(proxyAccountRequest).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("clears an undecodable session cookie", async () => {
    canAccessManagementApi.mockResolvedValue(true);
    const res = await proxy(request("/fe/service/login", "garbage"));
    expect(proxyAccountRequest).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("proxies Xiaomi login paths but not app paths for an authorized session", async () => {
    canAccessManagementApi.mockResolvedValue(true);
    const cookie = encodeSessionCookie(beginSession("sgp"));
    const res = await proxy(request("/fe/service/login", cookie));
    expect(proxyAccountRequest).toHaveBeenCalledTimes(1);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=v2.`);

    await proxy(request("/dashboard/providers/xiaomi-mimo", cookie));
    expect(proxyAccountRequest).toHaveBeenCalledTimes(1);
    expect(dashboardProxy).toHaveBeenCalledTimes(1);
  });
});
