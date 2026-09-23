import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatGptWebExecutor,
  resolveChatGptWebTransport,
} from "../../open-sse/executors/chatgpt-web.js";
import { ChatGptWebHttpExecutor, __resetChatGptWebCachesForTesting } from "../../open-sse/executors/chatgpt-web-http.js";
import { __setTlsFetchOverrideForTesting } from "../../open-sse/services/chatgptTlsClient.js";
import {
  BrowserUnavailableError,
  acquireBrowserContext,
  resolvePlaywrightProxy,
} from "../../open-sse/services/browserPool.js";
import {
  cookieStringToChatGptWebStorageState,
  executeChatGptWebCleanRoom,
  resolveChatGptWebHeadless,
} from "../../open-sse/utils/chatgptWebExecutorAdapter.js";

const NAME = "__Secure-next-auth.session-token";
const ok = (text) => ({ response: new Response(text), url: "", headers: {}, transformedBody: null });

function makeExecutor({ runBrowser } = {}) {
  const httpExecutor = { execute: vi.fn(async () => ok("http")) };
  const browser = vi.fn(runBrowser ?? (async () => new Response("browser")));
  const executor = new ChatGptWebExecutor({ httpExecutor, runBrowser: browser });
  return { executor, httpExecutor, browser };
}

const input = (overrides = {}) => ({
  model: "gpt-5-6",
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: false,
  credentials: { apiKey: "tok", connectionId: "conn-1", providerSpecificData: {} },
  ...overrides,
});

describe("resolveChatGptWebTransport", () => {
  it("defaults to auto and accepts browser/http in any case", () => {
    expect(resolveChatGptWebTransport(undefined)).toBe("auto");
    expect(resolveChatGptWebTransport({ transport: "bogus" })).toBe("auto");
    expect(resolveChatGptWebTransport({ transport: " HTTP " })).toBe("http");
    expect(resolveChatGptWebTransport({ transport: "browser" })).toBe("browser");
  });
});

describe("ChatGptWebExecutor transport selection", () => {
  it("uses the browser transport by default", async () => {
    const { executor, httpExecutor, browser } = makeExecutor();
    const result = await executor.execute(input());
    expect(await result.text()).toBe("browser");
    expect(browser).toHaveBeenCalledOnce();
    expect(httpExecutor.execute).not.toHaveBeenCalled();
  });

  it("uses HTTP when the connection selects it", async () => {
    const { executor, httpExecutor, browser } = makeExecutor();
    const credentials = { apiKey: "tok", connectionId: "c", providerSpecificData: { transport: "http" } };
    await executor.execute(input({ credentials }));
    expect(httpExecutor.execute).toHaveBeenCalledOnce();
    expect(browser).not.toHaveBeenCalled();
  });

  it("routes tool requests to HTTP in auto mode (the browser path has no tool emulation)", async () => {
    const { executor, httpExecutor, browser } = makeExecutor();
    const body = { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "f" } }] };
    await executor.execute(input({ body }));
    expect(httpExecutor.execute).toHaveBeenCalledOnce();
    expect(browser).not.toHaveBeenCalled();
  });

  it("falls back to HTTP in auto mode when the browser cannot start", async () => {
    const { executor, httpExecutor } = makeExecutor({
      runBrowser: async () => {
        throw new BrowserUnavailableError("Chromium is not installed.");
      },
    });
    const result = await executor.execute(input());
    expect(httpExecutor.execute).toHaveBeenCalledOnce();
    expect(await result.response.text()).toBe("http");
  });

  it("does not fall back when the connection pins the browser transport", async () => {
    const { executor, httpExecutor } = makeExecutor({
      runBrowser: async () => {
        throw new BrowserUnavailableError("Chromium is not installed.");
      },
    });
    const credentials = { apiKey: "tok", connectionId: "c", providerSpecificData: { transport: "browser" } };
    const result = await executor.execute(input({ credentials }));
    expect(httpExecutor.execute).not.toHaveBeenCalled();
    expect(result.response.status).toBe(503);
    expect((await result.response.json()).error.message).toMatch(/Chromium is not installed/);
  });

  it("does not fall back on upstream errors, and maps quota errors to 429", async () => {
    const { executor, httpExecutor } = makeExecutor({
      runBrowser: async () => {
        throw new Error("ChatGPT usage limit reached");
      },
    });
    const result = await executor.execute(input());
    expect(httpExecutor.execute).not.toHaveBeenCalled();
    expect(result.response.status).toBe(429);
  });

  it("hands the connection proxy to the browser transport", async () => {
    const { executor, browser } = makeExecutor();
    await executor.execute(
      input({ proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://u:p@proxy.test:8080" } })
    );
    expect(browser.mock.calls[0][0].proxyUrl).toBe("http://u:p@proxy.test:8080");
  });
});

describe("HTTP transport proxy routing", () => {
  afterEach(() => __setTlsFetchOverrideForTesting(null));

  it("routes every tls-client call through the connection proxy", async () => {
    __resetChatGptWebCachesForTesting();
    const proxies = new Set();
    __setTlsFetchOverrideForTesting(async (_url, opts) => {
      proxies.add(opts.proxyUrl);
      return { status: 401, headers: new Headers(), text: "", body: null };
    });
    await new ChatGptWebHttpExecutor().execute({
      ...input(),
      proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:3128" },
    });
    expect([...proxies]).toEqual(["http://proxy.test:3128"]);
  });
});

describe("browser pool helpers", () => {
  it("converts a proxy URL into Playwright's proxy option", () => {
    expect(resolvePlaywrightProxy(undefined)).toBeUndefined();
    expect(resolvePlaywrightProxy("socks5://proxy.test:1080")).toEqual({ server: "socks5://proxy.test:1080" });
    expect(resolvePlaywrightProxy("http://a%40b:p%3Aw@proxy.test:8080")).toEqual({
      server: "http://proxy.test:8080",
      username: "a@b",
      password: "p:w",
    });
  });

  it("reports a disabled pool as BrowserUnavailableError", async () => {
    vi.stubEnv("DURINDOOR_BROWSER_POOL", "off");
    try {
      await expect(acquireBrowserContext("k", { cookieDomain: "chatgpt.com" })).rejects.toBeInstanceOf(
        BrowserUnavailableError
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("browser adapter credentials", () => {
  it("builds a storage state from a chunked Cookie header", () => {
    const state = cookieStringToChatGptWebStorageState(
      `${NAME}.1=B; __Host-next-auth.csrf-token=x; ${NAME}.0=A; cf_clearance=cf`
    );
    expect(state.origins).toEqual([]);
    expect(state.cookies.map((c) => [c.name, c.value, c.httpOnly])).toEqual([
      [`${NAME}.0`, "A", true],
      [`${NAME}.1`, "B", true],
      ["cf_clearance", "cf", false],
    ]);
    expect(state.cookies.every((c) => c.domain === ".chatgpt.com" && c.secure)).toBe(true);
  });

  it("reads headless from the connection, then the environment", () => {
    expect(resolveChatGptWebHeadless({ headless: true }, {})).toBe(true);
    expect(resolveChatGptWebHeadless({ headless: false }, { DURINDOOR_CHATGPT_WEB_HEADLESS: "1" })).toBe(false);
    expect(resolveChatGptWebHeadless({}, { DURINDOOR_CHATGPT_WEB_HEADLESS: "true" })).toBe(true);
    expect(resolveChatGptWebHeadless({}, {})).toBe(false);
  });

  function browserDeps(liveCookies) {
    return {
      createSession: vi.fn(async () => ({})),
      runTurn: vi.fn(async () => ({ text: "pong" })),
      readSessionCookies: async () => liveCookies,
      id: () => "chatcmpl-test",
      now: () => 1_700_000_000_000,
    };
  }

  it("seeds the session from the cookie and returns an OpenAI completion", async () => {
    const deps = browserDeps([]);
    const response = await executeChatGptWebCleanRoom(
      { ...input(), credentials: { apiKey: `${NAME}=tok`, connectionId: "conn-1" }, proxyUrl: "http://p.test:1" },
      deps
    );
    const session = deps.createSession.mock.calls[0][0];
    expect(session.storageState.cookies[0]).toMatchObject({ name: NAME, value: "tok" });
    expect(session.proxyUrl).toBe("http://p.test:1");
    expect(session.selection).toEqual({ kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 0 });
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("pong");
    expect(json.id).toBe("chatcmpl-test");
  });

  it("persists rotated session chunks after the turn", async () => {
    const deps = browserDeps([
      { name: `${NAME}.0`, value: "NEW0" },
      { name: `${NAME}.1`, value: "NEW1" },
      { name: "oai-did", value: "ignored" },
    ]);
    const onCredentialsRefreshed = vi.fn();
    const credentials = { apiKey: `${NAME}=OLD; cf_clearance=cf`, connectionId: "conn-1" };
    await executeChatGptWebCleanRoom({ ...input(), credentials, onCredentialsRefreshed }, deps);
    expect(onCredentialsRefreshed).toHaveBeenCalledWith({
      ...credentials,
      apiKey: `cf_clearance=cf; ${NAME}.0=NEW0; ${NAME}.1=NEW1`,
    });
  });

  it("does not persist when nothing rotated", async () => {
    const deps = browserDeps([{ name: NAME, value: "SAME" }]);
    const onCredentialsRefreshed = vi.fn();
    const credentials = { apiKey: `${NAME}=SAME`, connectionId: "conn-1" };
    await executeChatGptWebCleanRoom({ ...input(), credentials, onCredentialsRefreshed }, deps);
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
  });
});
