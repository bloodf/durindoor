// Bootstrap Next's Node globals before any framework imports create async stores.
import "next/dist/server/node-environment.js";
import http from "node:http";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import actualNextConfig from "../../next.config.mjs";

// Real product imports resolve DATA_DIR at module initialization, before hooks run.
const isolatedData = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const previous = process.env.DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "web-login-next-transport-"));
  process.env.DATA_DIR = directory;
  return { directory, previous };
});

const loginConfig = vi.hoisted(() => ({ origin: "", startUrl: "", cookieNames: ["session"] }));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [{ id: "cookie-web", webLogin: loginConfig }] }));
import proxy from "../../src/proxy.js";
import { beginSession, destroySession, issueBootstrap, proxySessionCookie } from "../../src/lib/webLoginSession.js";

const require = createRequire(import.meta.url);
const { adapter } = require("next/dist/server/web/adapter.js");
const { getResolveRoutes } = require("next/dist/server/lib/router-utils/resolve-routes.js");
const { proxyRequest } = require("next/dist/server/lib/router-utils/proxy-request.js");
const { defaultConfig } = require("next/dist/server/config-shared.js");
const loadCustomRoutes = require("next/dist/lib/load-custom-routes.js").default;
const { buildCustomRoute } = require("next/dist/server/lib/router-utils/filesystem.js");
const nextConfig = {
  ...defaultConfig,
  ...actualNextConfig,
  experimental: { ...defaultConfig.experimental, ...actualNextConfig.experimental, trustHostHeader: true },
};
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

/** Real Next custom-route compilation and resolver run before the installed adapter. */
async function transport(vendorHeaders, status = 200, {
  bootstrap = false, startPath = "/login", providerResponse,
} = {}) {
  const appDispatches = [];
  const escapedRequests = [];
  const providerRequests = [];
  const providerPaths = [];
  const providerMethods = [];
  const failures = [];
  const middlewareRequests = [];
  const attacker = await listen((req, res) => {
    escapedRequests.push({ url: req.url, headers: { ...req.headers } });
    res.end("arbitrary-host dispatch");
  });
  const provider = await listen((req, res) => {
    providerRequests.push({ ...req.headers });
    providerPaths.push(req.url);
    providerMethods.push(req.method);
    if (providerResponse) {
      providerResponse(req, res);
      return;
    }
    const headers = vendorHeaders(attacker.url, provider.url);
    res.writeHead(status, { "content-type": "text/plain", "x-provider-response": "preserved", ...headers });
    res.end("provider response");
  });
  loginConfig.origin = provider.url;
  loginConfig.startUrl = `${provider.url}${startPath}`;
  const sess = beginSession("cookie-web", { loginOrigin: LOGIN, dashboardOrigin: "https://gateway.example" });
  sessions.add(sess);
  const cookie = `${proxySessionCookie(sess).split(";")[0]}; auth_token=dashboard-cookie`;
  const incoming = { host: LOGIN_HOST, authorization: "Bearer dashboard-key", "x-9r-cli-token": "dashboard-cli" };
  if (!bootstrap) incoming.cookie = cookie;
  const routedRequests = [];
  const customRoutes = await loadCustomRoutes(nextConfig);
  const compileRoutes = (type, items) => items.map((item) =>
    buildCustomRoute(type, item, nextConfig.basePath, nextConfig.experimental.caseSensitiveRoutes));
  const fsChecker = {
    buildId: "isolated-transport-fixture",
    headers: compileRoutes("header", customRoutes.headers),
    redirects: compileRoutes("redirect", customRoutes.redirects),
    rewrites: Object.fromEntries(Object.entries(customRoutes.rewrites).map(([phase, items]) =>
      [phase, compileRoutes(phase === "beforeFiles" ? "before_files_rewrite" : "rewrite", items)])),
    onMatchHeaders: [],
    getMiddlewareMatchers: () => () => true,
    getDynamicRoutes: () => [],
    handleLocale: (pathname) => ({ pathname }),
    getItem: async (pathname) => pathname.startsWith("/api/") ? { type: "appFile", itemPath: pathname } : null,
  };
  const resolve = getResolveRoutes(fsChecker, nextConfig,
    { dir: process.cwd(), dev: false, minimalMode: false, hostname: LOGIN_HOST, port: 443 }, {
    initialize: async () => ({ requestHandler: async (req) => {
      middlewareRequests.push(req.url);
      const result = await adapter({
        page: "/src/proxy",
        handler: proxy,
        request: {
          url: `${LOGIN}${req.url}`, method: req.method, headers: req.headers,
          nextConfig,
        },
      });
      await result.waitUntil;
      throw Object.assign(new Error("Next middleware response"), { result });
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
  const request = async (path, headers = incoming) => {
    const result = await get(`${router.url}${path}`, headers);
    expect(failures).toEqual([]);
    return result;
  };
  const bootstrapUrl = bootstrap ? new URL(issueBootstrap(sess)) : null;
  const initialPath = bootstrapUrl ? bootstrapUrl.pathname + bootstrapUrl.search : "/__web_login/cookie-web/login";
  const response = await request(initialPath);
  let landing, replay, navigation, browserDestination, browserCookie;
  if (bootstrap) {
    expect(response.status).toBe(303);
    // Follow Location as a browser would, retaining only the isolated host's cookie.
    browserDestination = new URL(response.headers.location, LOGIN);
    expect(browserDestination.origin).toBe(LOGIN);
    browserCookie = response.headers["set-cookie"][0].split(";")[0];
    const browserHeaders = { host: LOGIN_HOST, cookie: browserCookie };
    landing = await request(`${browserDestination.pathname}${browserDestination.search}`, browserHeaders);
    replay = await request(initialPath, browserHeaders);
    navigation = await request("/__web_login/cookie-web/account", browserHeaders);
  }
  expect(failures).toEqual([]);
  return {
    response, incoming, routedRequests, middlewareRequests, providerRequests, providerPaths, providerMethods,
    appDispatches, escapedRequests, landing, replay, navigation, browserDestination, browserCookie, sess, request,
  };
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
afterAll(() => {
  if (isolatedData.previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = isolatedData.previous;
  rmSync(isolatedData.directory, { recursive: true, force: true });
});

describe("provider response containment at the Next routing transport", () => {

  it("bootstraps to the provider root without slash removal and rejects one-time grant replay", async () => {
    const result = await transport(() => ({}), 200, { bootstrap: true, startPath: "/" });
    expect(result.response.status).toBe(303);
    expect(result.browserDestination.href).toBe(`${LOGIN}/__web_login/cookie-web/`);
    expect(result.response.headers["cache-control"]).toBe("no-store");
    expect(result.response.headers["referrer-policy"]).toBe("no-referrer");
    const cookie = result.response.headers["set-cookie"][0];
    expect(cookie).toContain("Path=/;");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).not.toMatch(/;\s*Domain=/i);
    expect(result.browserCookie).toBe(`dd_web_login_proxy=${result.sess.proxyId}`);
    expect(result.landing.status).toBe(200);
    expect(result.landing.body).toBe("provider response");
    expect(result.landing.headers.location).toBeUndefined();
    expect(result.replay.status).toBe(403);
    expect(result.replay.headers["set-cookie"]).toBeUndefined();
    expect(result.navigation.status).toBe(200);
    expect(result.navigation.body).toBe("provider response");
    expect(result.providerRequests).toHaveLength(2);
    expect(result.providerPaths).toEqual(["/", "/account"]);
    expect(result.providerMethods).toEqual(["GET", "GET"]);
    for (const headers of result.providerRequests) {
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-9r-cli-token"]).toBeUndefined();
    }
    expect(result.appDispatches).toEqual([]);
    expect(result.escapedRequests).toEqual([]);
  });

  it.each(["/chat/", "/account/?return=%2Fchat%2F&mode=login"])(
    "follows the provider HTTP redirect to exact %s once without a canonicalization loop",
    async (upstreamPath) => {
      const result = await transport(() => ({}), 200, {
        providerResponse(req, res) {
          if (req.url === "/login") {
            res.writeHead(302, { location: upstreamPath });
            res.end();
          } else {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end(`provider ${req.url}`);
          }
        },
      });
      expect(result.response.status).toBe(302);
      const destination = new URL(result.response.headers.location, LOGIN);
      expect(destination.href).toBe(`${LOGIN}/__web_login/cookie-web${upstreamPath}`);
      // Native HTTP never follows redirects itself: this is the browser's one follow.
      const landing = await result.request(destination.pathname + destination.search);
      expect(landing.status).toBe(200);
      expect(landing.headers.location).toBeUndefined();
      expect(landing.body).toBe(`provider ${upstreamPath}`);
      expect(result.providerPaths).toEqual(["/login", upstreamPath]);
      expect(result.providerMethods).toEqual(["GET", "GET"]);
      expect(result.appDispatches).toEqual([]);
      expect(result.escapedRequests).toEqual([]);
    },
  );

  it("keeps dashboard, MiMo-origin, and framework trailing slash redirects before downstream dispatch", async () => {
    const result = await transport(() => ({}));
    const paths = [
      "/dashboard/?tab=providers",
      "/pass/serviceLogin/?sid=xiaomiio",
      "/_next/static/chunk.js/?build=fixture",
    ];
    for (const path of paths) {
      const response = await result.request(path, {
        host: "gateway.example", cookie: "dd_mimo_login=untrusted-session",
      });
      expect(response.status).toBe(308);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(new URL(response.headers.location, "https://gateway.example").href)
        .toBe(`https://gateway.example${path.replace("/?", "?")}`);
    }
    expect(result.providerPaths).toEqual(["/login"]);
    expect(result.appDispatches).toEqual([]);
  });

  it("denies isolated app and administration paths before canonicalization, middleware, or dispatch", async () => {
    const result = await transport(() => ({}));
    const middlewareBefore = result.middlewareRequests.length;
    const routedBefore = result.routedRequests.length;
    for (const path of ["/dashboard/", "/api/providers/secret/reveal/", "/api/settings/"]) {
      const response = await result.request(path);
      expect(response.status).toBe(403);
      expect(response.headers.location).toBeUndefined();
    }
    expect(result.middlewareRequests).toHaveLength(middlewareBefore);
    expect(result.routedRequests).toHaveLength(routedBefore);
    expect(result.providerPaths).toEqual(["/login"]);
    expect(result.appDispatches).toEqual([]);
    expect(result.escapedRequests).toEqual([]);
  });

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

  it("reconstructs the ordinary provider redirect in the adapter without server-side redispatch", async () => {
    const result = await transport((_attacker, provider) => ({ location: `${provider}/signed-in?next=chat` }), 302);
    expect(result.response.status).toBe(302);
    expect(new URL(result.response.headers.location, LOGIN).href).toBe(`${LOGIN}/__web_login/cookie-web/signed-in?next=chat`);
    expect(result.appDispatches).toEqual([]);
    expect(result.escapedRequests).toEqual([]);
  });
});
