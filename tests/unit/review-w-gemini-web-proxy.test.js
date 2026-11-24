/** Regression for #2467: Gemini Web's Playwright browser must fail closed under strictProxy. */
import { describe, expect, it } from "vitest";
import { resolveGeminiWebBrowserProxy } from "../../open-sse/executors/gemini-web.js";

const PROXY = "http://proxy.example.test:8080";
const RELAY = "https://relay.example.test/api/relay";

describe("Gemini Web browser proxy (#2467)", () => {
  it("rejects a strict relay because it cannot provide CONNECT", () => {
    expect(() =>
      resolveGeminiWebBrowserProxy({
        vercelRelayUrl: RELAY,
        strictProxy: true,
        disableEnvProxy: true,
      })
    ).toThrow(/relay does not support CONNECT/i);
  });

  it("rejects a strict connection proxy bypassed by NO_PROXY", () => {
    expect(() =>
      resolveGeminiWebBrowserProxy({
        connectionProxyEnabled: true,
        connectionProxyUrl: PROXY,
        connectionNoProxy: "gemini.google.com",
        strictProxy: true,
        disableEnvProxy: true,
      })
    ).toThrow(/Proxy required but unavailable/);
  });

  it("uses a normal connection proxy", () => {
    expect(
      resolveGeminiWebBrowserProxy({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://user:pw@proxy.example.test:8080",
        disableEnvProxy: true,
      })
    ).toEqual({ server: PROXY, username: "user", password: "pw" });
  });
});
