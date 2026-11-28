// DurinDoor (MIT). #2034: the Muse Spark Web browser refresh must use the selected connection's route.
//
// Mocked contracts only. The browser engines, the pool's browser process, the proxy dispatchers
// and the network are fakes; no real browser, proxy or provider is used. Live proxy routing of a
// launched browser and Meta's acceptance of the cookie are unverified.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectObscuraBrowser } from "open-sse/services/obscura.js";
import { chromium } from "playwright";
import { shutdownPool } from "open-sse/services/browserPool.js";
import * as transport from "open-sse/utils/proxyFetch.js";
import { getExecutor } from "open-sse/executors/index.js";
import {
  __fetchFreshAccessTokenForTesting as refresh,
  __resetMuseSparkTokenCacheForTesting,
  __setMuseSparkBrowserPoolForTesting,
} from "open-sse/executors/muse-spark-web/fresh-access-token.js";
import { MUSE_REFRESH_LIMITS } from "open-sse/executors/muse-spark-web/fresh-access-token.js";
import { __museRefreshLockCountForTesting, PROXY_CAPABLE_ENGINES } from "open-sse/executors/muse-spark-web/browser-route.js";

vi.mock("open-sse/services/obscura.js", () => ({ connectObscuraBrowser: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch: vi.fn() } }));

const PROXY_A = "http://user-a:pw-a-2034@proxy-a.invalid:8001";
const PROXY_B = "socks5://user-b:pw-b-2034@proxy-b.invalid:8002";
const COOKIE_A = "ecto_1_sess=cookieA2034";
const COOKIE_B = "ecto_1_sess=cookieB2034";
const SECRETS = ["cookieA2034", "cookieB2034", "pw-a-2034", "pw-b-2034", "rotated2034"];
const strict = (url) => ({ connectionProxyEnabled: true, connectionProxyUrl: url, strictProxy: true, disableEnvProxy: true });
const loose = (url) => ({ connectionProxyEnabled: true, connectionProxyUrl: url, disableEnvProxy: true });
const DIRECT = { disableEnvProxy: true };

let sent, contexts, logs, restoreOriginal, bootstrap;

// One fake Playwright browser. Each context records its options, cookies and pages.
function fakeBrowser({ gotoImpl } = {}) {
  let connected = true;
  return {
    isConnected: () => connected,
    async newContext(options) {
      const ctx = { options, cookies: [], pageList: [], closed: false };
      ctx.addCookies = vi.fn(async (cookies) => { ctx.cookies.push(...cookies); });
      ctx.newPage = vi.fn(async () => {
        const page = {
          route: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}),
          goto: vi.fn(gotoImpl || (async () => {})), url: () => "https://www.meta.ai/",
          content: vi.fn(async () => `"accessToken":"ecto1:tok-${ctx.cookies.at(-1)?.value}"`),
          close: vi.fn(async () => {}),
        };
        ctx.pageList.push(page);
        return page;
      });
      ctx.close = vi.fn(async () => { ctx.closed = true; });
      ctx.pages = () => ctx.pageList;
      ctx.isClosed = () => ctx.closed;
      contexts.push(ctx);
      return ctx;
    },
    async close() { connected = false; },
  };
}

beforeEach(() => {
  sent = []; contexts = []; bootstrap = () => Response.json({});
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
  const dispatchers = new Map([[PROXY_A, { proxy: "A" }], [PROXY_B, { proxy: "B" }]]);
  for (const [url, dispatcher] of dispatchers) transport.__setProxyDispatcherForTesting(url, dispatcher);
  restoreOriginal = transport.__setOriginalFetchForTesting(async (url, init) => {
    sent.push({ url: String(url), route: init.dispatcher?.proxy ?? "unknown", cookie: init.headers?.Cookie });
    return bootstrap(init);
  });
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    sent.push({ url: String(url), route: "direct", cookie: init.headers?.Cookie });
    return bootstrap(init);
  }));
  connectObscuraBrowser.mockImplementation(async () => null);
  chromium.launch.mockImplementation(async () => fakeBrowser());
});

afterEach(async () => {
  restoreOriginal();
  transport.__clearProxyDispatchersForTesting();
  __setMuseSparkBrowserPoolForTesting(undefined);
  __resetMuseSparkTokenCacheForTesting();
  await shutdownPool("test-cleanup");
  const text = logs.flatMap((spy) => spy.mock.calls).map((call) => call.map(String).join(" ")).join("\n");
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("#2034 browser refresh through the real pool", () => {
  it("binds each account's proxy and credentials to the context that receives its cookie (chromium)", async () => {
    const [a, b] = await Promise.all([refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A)), refresh(COOKIE_B, undefined, "conn-b", strict(PROXY_B))]);
    expect(a).toMatchObject({ ok: true, token: "ecto1:tok-cookieA2034" });
    expect(b).toMatchObject({ ok: true, token: "ecto1:tok-cookieB2034" });
    expect(sent.map(({ route, cookie }) => [route, cookie]).sort()).toEqual([["A", COOKIE_A], ["B", COOKIE_B]]);
    const byCookie = Object.fromEntries(contexts.map((ctx) => [ctx.cookies[0].value, ctx.options.proxy]));
    expect(byCookie).toEqual({
      cookieA2034: { server: "http://proxy-a.invalid:8001", username: "user-a", password: "pw-a-2034" },
      cookieB2034: { server: "socks5://proxy-b.invalid:8002", username: "user-b", password: "pw-b-2034" },
    });
    for (const ctx of contexts) {
      expect(ctx.pageList[0].close).toHaveBeenCalled();
      expect(ctx.close).toHaveBeenCalled();
    }
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chromium.launch.mock.calls)).not.toContain("proxy-a");
  });

  it("gives a direct connection a context with no proxy", async () => {
    expect((await refresh(COOKIE_A, undefined, "direct", DIRECT)).ok).toBe(true);
    expect(sent.map((s) => s.route)).toEqual(["direct"]);
    expect(contexts[0].options.proxy).toBeUndefined();
  });

  it("refuses a proxied refresh on Obscura before placing the cookie, and allows a direct one", async () => {
    connectObscuraBrowser.mockImplementation(async () => ({ browser: fakeBrowser() }));
    const refused = await refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A));
    expect(refused).toMatchObject({ ok: false, status: 503, refused: true });
    expect(contexts[0].addCookies).not.toHaveBeenCalled();
    expect(contexts[0].newPage).not.toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalled();
    expect((await refresh(COOKIE_A, undefined, "conn-a", DIRECT)).ok).toBe(true);
    expect(PROXY_CAPABLE_ENGINES.has("obscura")).toBe(false);
    expect(PROXY_CAPABLE_ENGINES.has("cloakbrowser")).toBe(false);
  });

  it("closes the page and context when navigation fails", async () => {
    chromium.launch.mockImplementation(async () => fakeBrowser({ gotoImpl: async () => { throw new Error(`net::ERR via ${PROXY_A} for ${COOKIE_A}`); } }));
    const result = await refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A));
    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(401);
    for (const secret of SECRETS) expect(result.error).not.toContain(secret);
    expect(contexts[0].pageList[0].close).toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalled();
  });
});

describe("#2034 routes refused before any send", () => {
  const seamSpy = () => {
    const acquire = vi.fn();
    __setMuseSparkBrowserPoolForTesting({ acquire, openPage: vi.fn(), release: vi.fn() });
    return acquire;
  };
  it.each([
    ["strict relay", { vercelRelayUrl: "https://relay.invalid/", strictProxy: true, disableEnvProxy: true }],
    ["non-strict relay", { vercelRelayUrl: "https://relay.invalid/" }],
    ["strict with no proxy", { strictProxy: true, disableEnvProxy: true }],
    ["unsupported proxy scheme", strict("ftp://proxy.invalid:21")],
    ["proxy bypassed by noProxy under strict", { ...strict(PROXY_A), connectionNoProxy: "www.meta.ai" }],
  ])("%s", async (_label, proxyOptions) => {
    const acquire = seamSpy();
    const result = await refresh(COOKIE_A, undefined, "conn-a", proxyOptions);
    expect(result).toMatchObject({ ok: false, status: 503, refused: true });
    expect(sent).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
    for (const secret of SECRETS) expect(result.error).not.toContain(secret);
  });

  it("refuses pre-aborted requests without work", async () => {
    const acquire = seamSpy();
    const controller = new AbortController();
    controller.abort();
    expect((await refresh(COOKIE_A, controller.signal, "conn-a", strict(PROXY_A))).ok).toBe(false);
    expect(sent).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe("#2034 cache and context keys", () => {
  let acquired;
  beforeEach(() => {
    acquired = [];
    __setMuseSparkBrowserPoolForTesting({
      acquire: async (key, options) => {
        const pooled = { key, options, value: "" };
        pooled.context = { addCookies: async (cookies) => { pooled.value = cookies[0].value; } };
        acquired.push(pooled);
        return pooled;
      },
      openPage: async (pooled) => ({
        route: async () => {}, routeWebSocket: async () => {}, goto: async () => {}, close: async () => {},
        url: () => "https://www.meta.ai/", content: async () => `"accessToken":"ecto1:tok-${pooled.value}"`,
      }),
      release: async () => {},
    });
  });

  it("reuses a token only for the same connection, cookie and route", async () => {
    await refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A));
    await refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A));
    expect(acquired).toHaveLength(1);
    await refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_B));
    await refresh(COOKIE_A, undefined, "conn-a", DIRECT);
    await refresh("ecto_1_sess=rotated2034", undefined, "conn-a", strict(PROXY_A));
    await refresh(COOKIE_A, undefined, "conn-other", strict(PROXY_A));
    expect(acquired).toHaveLength(5);
    expect(new Set(acquired.map((p) => p.key)).size).toBe(5);
    expect(acquired.map((p) => p.options.proxyUrl ?? null)).toEqual([PROXY_A, PROXY_B, null, PROXY_A, PROXY_A]);
    expect(sent.map((s) => s.route)).toEqual(["A", "B", "direct", "A", "A"]);
    for (const { key } of acquired) for (const secret of [...SECRETS, "proxy-a", "user-a"]) expect(key).not.toContain(secret);
  });

  it("keys a strict and a non-strict use of the same proxy to the same route", async () => {
    await refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A));
    await refresh(COOKIE_A, undefined, "conn-a", loose(PROXY_A));
    expect(acquired).toHaveLength(1);
  });

  it("serializes concurrent refreshes of one key and runs other accounts independently", async () => {
    const results = await Promise.all([
      refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A)),
      refresh(COOKIE_A, undefined, "conn-a", strict(PROXY_A)),
      refresh(COOKIE_B, undefined, "conn-b", strict(PROXY_B)),
    ]);
    expect(results.map((r) => r.token)).toEqual(["ecto1:tok-cookieA2034", "ecto1:tok-cookieA2034", "ecto1:tok-cookieB2034"]);
    expect(acquired.map((p) => p.value).sort()).toEqual(["cookieA2034", "cookieB2034"]);
    expect(sent).toHaveLength(2);
    await vi.waitFor(() => expect(__museRefreshLockCountForTesting()).toBe(0));
  });
});

describe("#2034 cancellation and bounds", () => {
  it("closes the page and releases the context when the caller aborts during navigation", async () => {
    const page = { route: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}), goto: vi.fn(() => new Promise(() => {})), url: () => "https://www.meta.ai/", content: vi.fn(), close: vi.fn(async () => {}) };
    const release = vi.fn(async () => {});
    __setMuseSparkBrowserPoolForTesting({ acquire: async () => ({ context: { addCookies: async () => {} } }), openPage: async () => page, release });
    const controller = new AbortController();
    const pending = refresh(COOKIE_A, controller.signal, "conn-a", strict(PROXY_A));
    await vi.waitFor(() => expect(page.goto).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, refused: true });
    expect(page.close).toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(page.content).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(__museRefreshLockCountForTesting()).toBe(0));
  });

  it("releases a context that arrives after the caller aborted the launch", async () => {
    let resolveLaunch;
    const release = vi.fn(async () => {});
    const openPage = vi.fn();
    __setMuseSparkBrowserPoolForTesting({ acquire: () => new Promise((resolve) => { resolveLaunch = resolve; }), openPage, release });
    const controller = new AbortController();
    const pending = refresh(COOKIE_A, controller.signal, "conn-late", strict(PROXY_A));
    await vi.waitFor(() => expect(resolveLaunch).toBeTypeOf("function"));
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(__museRefreshLockCountForTesting()).toBe(1);
    resolveLaunch({ context: { addCookies: vi.fn() } });
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(__museRefreshLockCountForTesting()).toBe(0));
    expect(openPage).not.toHaveBeenCalled();
  });

  it("refuses a launch that exceeds its bound", async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    __setMuseSparkBrowserPoolForTesting({ acquire: () => new Promise(() => {}), openPage: vi.fn(), release });
    const pending = refresh(COOKIE_A, undefined, "conn-bound", strict(PROXY_A));
    await vi.advanceTimersByTimeAsync(MUSE_REFRESH_LIMITS.launchMs + 1);
    expect(await pending).toMatchObject({ ok: false, status: 503, refused: true });
    expect(MUSE_REFRESH_LIMITS.launchMs).toBeLessThan(MUSE_REFRESH_LIMITS.overallMs);
    // A launch that never settles holds its key only up to the overall bound.
    expect(__museRefreshLockCountForTesting()).toBe(1);
    await vi.advanceTimersByTimeAsync(MUSE_REFRESH_LIMITS.overallMs + 1);
    expect(__museRefreshLockCountForTesting()).toBe(0);
    expect(release).not.toHaveBeenCalled();
  });

  it("refuses an oversized page body", async () => {
    __setMuseSparkBrowserPoolForTesting({
      acquire: async () => ({ context: { addCookies: async () => {} } }),
      openPage: async () => ({ route: async () => {}, routeWebSocket: async () => {}, goto: async () => {}, close: async () => {}, url: () => "https://www.meta.ai/", content: async () => "x".repeat(MUSE_REFRESH_LIMITS.maxHtmlChars + 1) }),
      release: async () => {},
    });
    expect(await refresh(COOKIE_A, undefined, "conn-a", DIRECT)).toMatchObject({ ok: false, status: 503, refused: true });
  });
});

describe("#2034 executor guard", () => {
  it("keeps a guarded connection on 501 with no cookie send or browser", async () => {
    const acquire = vi.fn();
    __setMuseSparkBrowserPoolForTesting({ acquire, openPage: vi.fn(), release: vi.fn() });
    const result = await getExecutor("muse-spark-web").execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, proxyOptions: strict(PROXY_A),
      credentials: { connectionId: "off", apiKey: COOKIE_A, providerSpecificData: { enableSessionDispatch: "true" } },
    });
    expect(result.response.status).toBe(501);
    expect(sent).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("answers a refused relay route as a non-auth failure with no traffic", async () => {
    const acquire = vi.fn();
    __setMuseSparkBrowserPoolForTesting({ acquire, openPage: vi.fn(), release: vi.fn() });
    const result = await getExecutor("muse-spark-web").execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] },
      proxyOptions: { vercelRelayUrl: "https://relay.invalid/", strictProxy: true },
      credentials: { connectionId: "relay", apiKey: COOKIE_A, providerSpecificData: { enableSessionDispatch: true } },
    });
    expect(result.response.status).toBe(502);
    expect(sent).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
  });
});
