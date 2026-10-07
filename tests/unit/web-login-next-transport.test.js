import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const loginConfig = vi.hoisted(() => ({ origin: "", startUrl: "", cookieNames: ["session"] }));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [{ id: "cookie-web", webLogin: loginConfig }] }));
vi.mock("../../src/dashboardGuard", () => ({
  proxy: async () => new Response("dashboard"),
  canAccessManagementApi: async () => true,
}));
import proxy from "../../src/proxy.js";
import { beginSession, destroySession, proxySessionCookie } from "../../src/lib/webLoginSession.js";

const require = createRequire(import.meta.url);
const { getResolveRoutes } = require("next/dist/server/lib/router-utils/resolve-routes.js");
const { proxyRequest } = require("next/dist/server/lib/router-utils/proxy-request.js");
const { defaultConfig } = require("next/dist/server/config-shared.js");
const boundary = require("../../web-login-host-boundary.cjs");
const LOGIN_HOST = "login.gateway.example";
const LOGIN = `https://${LOGIN_HOST}`;
const servers = new Set();
const sessions = new Set();

async function listen(handler) {
  const server = http.createServer(handler);
  servers.add(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

/** Actual installed Next resolver and outbound proxy consume the real T8 response. */
async function transport(vendorHeaders, status = 200) {
  const appDispatches = [];
  const escapedRequests = [];
  const providerRequests = [];
  const failures = [];
  const attacker = await listen((req, res) => {
    escapedRequests.push({ url: req.url, headers: { ...req.headers } });
    res.end("arbitrary-host dispatch");
  });
  const provider = await listen((req, res) => {
    providerRequests.push({ ...req.headers });
    const headers = vendorHeaders(attacker.url, provider.url);
    res.writeHead(status, { "content-type": "text/plain", "x-provider-response": "preserved", ...headers });
    res.end("provider response");
  });
  loginConfig.origin = provider.url;
  loginConfig.startUrl = `${provider.url}/login`;
  const sess = beginSession("cookie-web", { loginOrigin: LOGIN, dashboardOrigin: "https://gateway.example" });
  sessions.add(sess);
  const cookie = `${proxySessionCookie(sess).split(";")[0]}; auth_token=dashboard-cookie`;
  const incoming = { host: LOGIN_HOST, cookie, authorization: "Bearer dashboard-key", "x-9r-cli-token": "dashboard-cli" };
  const routedRequests = [];
  const fsChecker = {
    buildId: "isolated-transport-fixture",
    headers: [], redirects: [], rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
    onMatchHeaders: [],
    getMiddlewareMatchers: () => () => true,
    getDynamicRoutes: () => [],
    handleLocale: (pathname) => ({ pathname }),
    getItem: async (pathname) => pathname.startsWith("/api/") ? { type: "appFile", itemPath: pathname } : null,
  };
  const resolve = getResolveRoutes(fsChecker, {
    ...defaultConfig, experimental: { ...defaultConfig.experimental, trustHostHeader: true },
  }, { dir: process.cwd(), dev: false, minimalMode: false, hostname: LOGIN_HOST, port: 443 }, {
    initialize: async () => ({ requestHandler: async (req) => {
      const request = new NextRequest(`${LOGIN}${req.url}`, { headers: req.headers });
      const response = await proxy(request);
      throw Object.assign(new Error("Next middleware response"), { result: { response } });
    } }),
  }, {});
  const router = await listen(async (req, res) => {
    try {
      if (boundary.denyIsolatedHttpRequest(req, res)) return;
      const result = await resolve({ req, res, isUpgradeReq: false, invokedOutputs: new Set() });
      routedRequests.push({ ...req.headers });
      if (result.finished && result.parsedUrl.protocol && !result.statusCode) {
        await proxyRequest(req, res, result.parsedUrl);
        return;
      }
      for (const [name, value] of Object.entries(result.resHeaders)) res.setHeader(name, value);
      res.statusCode = result.statusCode || 200;
      if (result.bodyStream) {
        for await (const chunk of result.bodyStream) res.write(Buffer.from(chunk));
        res.end();
      } else if (result.statusCode && result.resHeaders.location) {
        res.end();
      } else {
        appDispatches.push({ path: result.parsedUrl.pathname, headers: { ...req.headers } });
        res.end("application dispatch");
      }
    } catch (error) {
      failures.push(error);
      res.statusCode = 500;
      res.end("transport failed");
    }
  });
  const response = await get(`${router.url}/__web_login/cookie-web/login`, incoming);
  expect(failures).toEqual([]);
  return { response, incoming, routedRequests, providerRequests, appDispatches, escapedRequests };
}

beforeEach(() => {
  vi.stubEnv("BASE_URL", "https://gateway.example");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://gateway.example");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", LOGIN);
});
afterEach(async () => {
  for (const sess of sessions) destroySession(sess.id);
  sessions.clear();
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
  servers.clear();
  vi.unstubAllEnvs();
});

describe("provider response containment at the Next routing transport", () => {
  it.each([
    ["application rewrite", () => ({ "x-middleware-rewrite": "/api/providers/secret/reveal" })],
    ["arbitrary-host rewrite", (attacker) => ({ "x-middleware-rewrite": `${attacker}/credential-collector` })],
    ["framework continuation", () => ({ "x-middleware-next": "1" })],
    ["request and cookie override", () => ({
      "x-middleware-override-headers": "host,cookie,authorization,x-9r-cli-token",
      "x-middleware-request-host": "gateway.example",
      "x-middleware-request-cookie": "auth_token=vendor-auth",
      "x-middleware-request-authorization": "Bearer vendor-key",
      "x-middleware-request-x-9r-cli-token": "vendor-cli",
      "x-middleware-set-cookie": "auth_token=vendor-auth; Domain=gateway.example; Path=/",
    })],
    ["other reserved routing namespaces", () => ({
      "x-nextjs-matched-path": "/api/providers/secret/reveal",
      "x-nextjs-rewritten-path": "/api/providers/secret/reveal",
      "x-invoke-path": "/api/providers/secret/reveal",
      "x-now-route-matches": "secret",
      "x-matched-path": "/api/providers/secret/reveal",
      "next-router-state-tree": "vendor-state",
      "next-action": "vendor-action",
      "x-action-redirect": "/api/providers/secret/reveal;push",
      rsc: "1",
    })],
    ["unknown middleware directive", () => ({ "x-middleware-future-control": "untrusted" })],
  ])("returns the provider body without dispatching %s", async (_label, headers) => {
    const result = await transport(headers);
    expect(result.response.status).toBe(200);
    expect(result.response.body).toBe("provider response");
    expect(result.response.headers["x-provider-response"]).toBe("preserved");
    expect(result.appDispatches).toEqual([]);
    expect(result.escapedRequests).toEqual([]);
    for (const name of Object.keys(headers("http://attacker.example", "http://provider.example"))) {
      expect(result.response.headers[name]).toBeUndefined();
      expect(result.routedRequests[0][name]).toBeUndefined();
    }
    expect(result.routedRequests[0].host).toBe(result.incoming.host);
    expect(result.routedRequests[0].cookie).toBe(result.incoming.cookie);
    expect(result.routedRequests[0].authorization).toBe(result.incoming.authorization);
    expect(result.routedRequests[0]["x-9r-cli-token"]).toBe(result.incoming["x-9r-cli-token"]);
    expect(result.routedRequests[0]["x-middleware-set-cookie"]).toBeUndefined();
    expect(result.providerRequests[0].cookie).toBeUndefined();
    expect(result.providerRequests[0].authorization).toBeUndefined();
    expect(result.providerRequests[0]["x-9r-cli-token"]).toBeUndefined();
  });

  it("preserves the ordinary rewritten provider Location without server-side redispatch", async () => {
    const result = await transport((_attacker, provider) => ({ location: `${provider}/signed-in?next=chat` }), 302);
    expect(result.response.status).toBe(302);
    expect(result.response.headers.location).toBe("/__web_login/cookie-web/signed-in?next=chat");
    expect(result.appDispatches).toEqual([]);
    expect(result.escapedRequests).toEqual([]);
  });
});
