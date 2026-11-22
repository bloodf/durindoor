/**
 * Regression for #2295: web-session TLS / Playwright / WebSocket transports
 * must fail closed under strictProxy (including strict relay pools and
 * NO_PROXY matches), matching proxyAwareFetch — never send session
 * credentials from the host IP.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveConnectProxyForRequest,
  resolveProxyForRequest,
  resolveWebSocketProxyRoute,
  __setOriginalFetchForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import { resolveTlsClientProxyUrl } from "../../open-sse/services/tlsClientProxy.js";
import { resolveProxyUrl, runWithTlsProxyOptions } from "../../open-sse/services/tlsClientBase.js";
import { ChatGptWebExecutor } from "../../open-sse/executors/chatgpt-web.js";
import {
  __setCopilotWebSocketForTesting,
  CopilotWebExecutor,
} from "../../open-sse/executors/copilot-web.js";
import {
  __setCopilotM365WebSocketForTesting,
  CopilotM365WebExecutor,
} from "../../open-sse/executors/copilot-m365-web.js";

const CHATGPT = "https://chatgpt.com/";
const GEMINI = "https://gemini.google.com/app";
const RELAY = "https://relay.example.test/api/relay";
const PROXY = "http://proxy.example.test:8080";

describe("resolveProxyForRequest / resolveConnectProxyForRequest (#2295)", () => {
  it("reports a vercel/cloudflare relay instead of falling through to direct", () => {
    const route = resolveProxyForRequest(CHATGPT, {
      vercelRelayUrl: RELAY,
      strictProxy: true,
      disableEnvProxy: true,
    });
    expect(route).toMatchObject({
      source: "relay",
      proxyUrl: null,
      vercelRelayUrl: RELAY,
      strict: true,
    });
  });

  it("fails closed for CONNECT transports when only a strict relay is configured", () => {
    expect(() =>
      resolveConnectProxyForRequest(CHATGPT, {
        vercelRelayUrl: RELAY,
        strictProxy: true,
        disableEnvProxy: true,
      })
    ).toThrow(/relay does not support CONNECT/i);
  });

  it("fails closed when strictProxy is set and no usable CONNECT route exists", () => {
    expect(() =>
      resolveConnectProxyForRequest(CHATGPT, { strictProxy: true, disableEnvProxy: true })
    ).toThrow(/Proxy required but unavailable/);
  });

  it("fails closed when a strict connection proxy is bypassed by NO_PROXY", () => {
    expect(() =>
      resolveConnectProxyForRequest(CHATGPT, {
        connectionProxyEnabled: true,
        connectionProxyUrl: PROXY,
        connectionNoProxy: "chatgpt.com",
        strictProxy: true,
        disableEnvProxy: true,
      })
    ).toThrow(/Proxy required but unavailable/);
  });

  it("leaves non-strict direct and relay fallbacks unchanged", () => {
    expect(resolveConnectProxyForRequest(CHATGPT, { disableEnvProxy: true })).toMatchObject({
      source: "direct",
      proxyUrl: null,
      strict: false,
    });
    expect(
      resolveConnectProxyForRequest(CHATGPT, {
        vercelRelayUrl: RELAY,
        disableEnvProxy: true,
      })
    ).toMatchObject({ source: "direct", proxyUrl: null, strict: false });
    expect(
      resolveConnectProxyForRequest(GEMINI, {
        connectionProxyEnabled: true,
        connectionProxyUrl: PROXY,
        disableEnvProxy: true,
      })
    ).toMatchObject({ source: "connection", proxyUrl: PROXY });
  });
});

describe("TLS client proxy resolution (#2295)", () => {
  it("fails closed under runWithTlsProxyOptions for a strict unavailable pool", () => {
    expect(() =>
      runWithTlsProxyOptions({ strictProxy: true, disableEnvProxy: true }, () =>
        resolveProxyUrl("https://chatgpt.com")
      )
    ).toThrow(/Proxy required but unavailable|strictProxy/);
  });

  it("fails closed for a strict relay via resolveTlsClientProxyUrl", () => {
    expect(() =>
      resolveTlsClientProxyUrl(CHATGPT, null, (target) =>
        resolveProxyForRequest(target, {
          vercelRelayUrl: RELAY,
          strictProxy: true,
          disableEnvProxy: true,
        })
      )
    ).toThrow(/relay does not support TLS|refusing direct connection/i);
  });
});

describe("ChatGPT Web browser transport (#2295)", () => {
  it("fails closed before launching Playwright when strictProxy has no CONNECT route", async () => {
    const runBrowser = vi.fn();
    const executor = new ChatGptWebExecutor({
      runBrowser,
      httpExecutor: { execute: vi.fn() },
    });
    const result = await executor.execute({
      model: "gpt-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: {
        apiKey: "session",
        providerSpecificData: { transport: "browser" },
      },
      proxyOptions: { strictProxy: true, disableEnvProxy: true },
    });
    expect(runBrowser).not.toHaveBeenCalled();
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(await result.response.text()).toMatch(/Proxy required but unavailable|strictProxy/i);
  });
});

describe("WebSocket proxy routes (#2295)", () => {
  it("resolveWebSocketProxyRoute fails closed for strict relay and unavailable routes", () => {
    expect(() =>
      resolveWebSocketProxyRoute("wss://copilot.microsoft.com/c/api/chat", {
        vercelRelayUrl: RELAY,
        strictProxy: true,
      })
    ).toThrow(/relay does not support WebSocket/i);
    expect(() =>
      resolveWebSocketProxyRoute("wss://copilot.microsoft.com/c/api/chat", {
        strictProxy: true,
        disableEnvProxy: true,
      })
    ).toThrow(/WebSocket proxy required but unavailable/);
  });
});

describe("Copilot Web WebSocket agent (#2295)", () => {
  let restoreFetch;
  let restoreWs;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    restoreWs?.();
    restoreWs = undefined;
  });

  it("fails closed when a strict pool has no WebSocket-capable proxy", async () => {
    restoreFetch = __setOriginalFetchForTesting(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ currentConversationId: "conv-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    restoreWs = __setCopilotWebSocketForTesting(
      class {
        constructor() {
          throw new Error("WebSocket must not open without a proxy under strictProxy");
        }
      }
    );
    const result = await new CopilotWebExecutor().execute({
      model: "copilot",
      stream: false,
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "access_token=tok" },
      proxyOptions: { strictProxy: true, disableEnvProxy: true },
    });
    // /c/api/start itself fails closed via proxyAwareFetch before the socket.
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(await result.response.text()).toMatch(/Proxy required but unavailable|strictProxy/i);
  });

  it("resolves a connection-proxy WebSocket route the same way as HTTP", () => {
    const route = resolveWebSocketProxyRoute("wss://copilot.microsoft.com/c/api/chat", {
      connectionProxyEnabled: true,
      connectionProxyUrl: PROXY,
    });
    expect(route).toMatchObject({ enabled: true, url: PROXY, strict: false });
  });
});

describe("Microsoft 365 Copilot Web proxyOptions (#2295)", () => {
  let restoreWs;

  afterEach(() => {
    restoreWs?.();
    restoreWs = undefined;
  });

  it("fails closed under strictProxy without opening a direct WebSocket", async () => {
    const instances = [];
    restoreWs = __setCopilotM365WebSocketForTesting(
      class {
        constructor(url, options) {
          instances.push({ url, options });
          throw new Error("WebSocket must not open under unavailable strictProxy");
        }
        on() {
          return this;
        }
        send() {}
        close() {}
      }
    );

    const result = await new CopilotM365WebExecutor().execute({
      model: "copilot-m365",
      stream: false,
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: {
        apiKey: "access_token=SECRET123; chathubPath=user@tenant",
      },
      proxyOptions: { strictProxy: true, disableEnvProxy: true },
    });

    expect(instances).toHaveLength(0);
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(await result.response.text()).toMatch(
      /WebSocket proxy required but unavailable|Proxy required|strictProxy/i
    );
  });
});
