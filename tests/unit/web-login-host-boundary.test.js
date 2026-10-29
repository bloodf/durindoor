import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const boundary = require("../../web-login-host-boundary.cjs");
const { createOwnerAwareHandler, installRealtimeUpgradeDispatcher } = require("../../custom-server.js");

beforeEach(() => {
  vi.stubEnv("BASE_URL", "https://gateway.example");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.gateway.example");
});
afterEach(() => vi.unstubAllEnvs());

const request = (url, host = "login.gateway.example") => ({
  url, method: "GET", headers: {
    host, cookie: "auth_token=dashboard; dd_web_login=login",
    authorization: "Bearer valid-key", "x-9r-cli-token": "valid-cli",
  },
});

describe("isolated login hostname boundary", () => {
  it.each([
    "", "not-an-origin", "https://login.gateway.example/path", "https://login.gateway.example?x=1",
    "https://login.gateway.example#fragment", "https://user:pass@login.gateway.example",
    "ftp://login.gateway.example", "https://gateway.example:444", "https://gateway.example.",
  ])("fails closed for invalid or cookie-sharing origin %s", (origin) => {
    vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", origin);
    expect(boundary.configuredLoginOrigin("https://gateway.example")).toBeNull();
  });

  it("returns only a normalized isolated origin", () => {
    expect(boundary.configuredLoginOrigin("https://gateway.example")).toBe("https://login.gateway.example");
    expect(boundary.configuredLoginOrigin("invalid-dashboard")).toBeNull();
  });

  it.each([
    "/", "/dashboard", "/api/auth/login", "/api/providers", "/api/keys/k1/reveal",
    "/api/cli-tools/antigravity-mitm", "/v1/realtime", "/_next/static/app.js", "/favicon.ico",
    "/__web_login", "/__web_login/bootstrap/extra", "/__web_login/grok-web/../../api/settings",
    "/__web_login/grok-web/%2e%2e/api/settings", "/__web_login/grok-web/%252e%252e/api/settings",
    "/__web_login/grok-web/%2fapi/settings", "/__web_login/grok-web/\\api/settings",
    "https://gateway.example/__web_login/grok-web/",
  ])("denies %s before invoking Next regardless of credentials", (url) => {
    const handler = vi.fn();
    const wrapped = createOwnerAwareHandler(handler);
    const res = { writeHead: vi.fn(), end: vi.fn() };
    wrapped(request(url), res);
    expect(handler).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("Forbidden");
  });

  it.each(["/__web_login/bootstrap?grant=opaque", "/__web_login/grok-web/", "/__web_login/chatgpt-web/assets/app.js"])("allows only scoped HTTP path %s", (url) => {
    expect(boundary.allowsLoginRequest(request(url))).toBe(true);
  });

  it("denies even scoped paths when isolation config shares dashboard hostname", () => {
    vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://gateway.example:444");
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(boundary.denyIsolatedHttpRequest(request("/__web_login/grok-web/", "gateway.example"), res)).toBe(true);
  });

  it("keeps malformed configured login hosts closed", () => {
    vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.gateway.example/path");
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(boundary.denyIsolatedHttpRequest(request("/__web_login/grok-web/"), res)).toBe(true);
  });

  it("does not classify dashboard requests using forged forwarded Host", () => {
    const req = request("/api/providers", "gateway.example");
    req.headers["x-forwarded-host"] = "login.gateway.example";
    expect(boundary.isLoginHost(req)).toBe(false);
  });

  it.each(["/v1/realtime", "/dashboard", "/__web_login/grok-web/"])("blocks isolated upgrade %s before Next or realtime dispatch", async (url) => {
    const server = new EventEmitter();
    server.listen = vi.fn();
    server.close = vi.fn();
    const nextUpgrade = vi.fn();
    server.on("upgrade", nextUpgrade);
    installRealtimeUpgradeDispatcher(server);
    await new Promise((resolve) => queueMicrotask(resolve));
    const socket = { end: vi.fn(), destroy: vi.fn() };
    server.emit("upgrade", request(url), socket, Buffer.alloc(0));
    expect(nextUpgrade).not.toHaveBeenCalled();
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
  });

  it("enforces the host boundary from a packaged tree without checkout resolution", () => {
    const staged = mkdtempSync(path.join(tmpdir(), "web-login-package-"));
    try {
      mkdirSync(path.join(staged, "src/shared/utils"), { recursive: true });
      copyFileSync(new URL("../../web-login-host-boundary.cjs", import.meta.url), path.join(staged, "web-login-host-boundary.cjs"));
      copyFileSync(new URL("../../src/shared/utils/typeChecks.cjs", import.meta.url), path.join(staged, "src/shared/utils/typeChecks.cjs"));
      const packagedRequire = createRequire(path.join(staged, "package.json"));
      const packaged = packagedRequire("./web-login-host-boundary.cjs");
      expect(packaged.configuredLoginOrigin("https://gateway.example")).toBe("https://login.gateway.example");
      const res = { writeHead: vi.fn(), end: vi.fn() };
      expect(packaged.denyIsolatedHttpRequest(request("/api/keys/k1/reveal"), res)).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
      expect(packaged.allowsLoginRequest(request("/__web_login/grok-web/"))).toBe(true);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
  });
});
