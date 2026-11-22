import { describe, it, expect } from "vitest";
import { resolveGeminiWebBrowserProxy } from "../../open-sse/executors/gemini-web.js";

// OmniRoute #20739: the browser path must use the account proxy and never fall back to direct egress.
describe("gemini-web browser proxy (OmniRoute #20739)", () => {
  it("uses the account's connection proxy for the browser context", () => {
    const proxy = resolveGeminiWebBrowserProxy({ enabled: true, url: "http://user:pw@proxy.test:8080", disableEnvProxy: true });
    expect(proxy).toEqual({ server: "http://proxy.test:8080", username: "user", password: "pw" });
  });

  it("returns no proxy when none is assigned", () => {
    expect(resolveGeminiWebBrowserProxy({ disableEnvProxy: true })).toBeUndefined();
  });

  it("fails closed when the assigned proxy cannot be parsed", () => {
    expect(() => resolveGeminiWebBrowserProxy({ enabled: true, url: "bad proxy host:8080", disableEnvProxy: true }))
      .toThrow(/refusing a direct connection/);
  });
});
