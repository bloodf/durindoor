// Port of OmniRoute b3207ab010 (CodeQL #674,
// js/incomplete-url-substring-sanitization): the official-Anthropic check in
// DefaultExecutor.buildHeaders() must use exact hostname equality, not a
// substring `.includes("api.anthropic.com")`, so a look-alike upstream cannot
// impersonate the official endpoint and suppress the Bearer fallback intended
// for third-party gateways.
import { describe, expect, it } from "vitest";

import { isOfficialAnthropicBaseUrl } from "../../open-sse/utils/anthropicHost.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("isOfficialAnthropicBaseUrl", () => {
  it("recognizes official endpoints (scheme / path)", () => {
    expect(isOfficialAnthropicBaseUrl("https://api.anthropic.com")).toBe(true);
    expect(isOfficialAnthropicBaseUrl("https://api.anthropic.com/v1")).toBe(true);
    expect(isOfficialAnthropicBaseUrl("https://api.anthropic.com/")).toBe(true);
    expect(isOfficialAnthropicBaseUrl("http://api.anthropic.com")).toBe(true);
  });

  it("rejects look-alike hosts the old substring check would have accepted", () => {
    expect(isOfficialAnthropicBaseUrl("https://api.anthropic.com.evil.test")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("https://api.anthropic.com.evil.test/v1")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("https://evil.test/?x=api.anthropic.com")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("https://evil.test/api.anthropic.com")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("https://my-gateway.test/anthropic")).toBe(false);
    // a genuinely different host
    expect(isOfficialAnthropicBaseUrl("https://openrouter.ai/api")).toBe(false);
  });

  it("returns false for empty / scheme-less / unparseable baseUrl", () => {
    // The "empty means default official endpoint" convention lives at the
    // default.js call site, not in this helper. Scheme-less hosts are not
    // valid URLs and fall through to false.
    expect(isOfficialAnthropicBaseUrl("")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("api.anthropic.com")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("api.anthropic.com/v1")).toBe(false);
    expect(isOfficialAnthropicBaseUrl("http://")).toBe(false);
    expect(isOfficialAnthropicBaseUrl(":::")).toBe(false);
  });
});

describe("DefaultExecutor.buildHeaders() — look-alike host treated as third-party", () => {
  // Behavior-level regression: a look-alike baseUrl must NOT be treated as the
  // official Anthropic host, so the first-party identity headers are stripped
  // and the Bearer fallback is emitted.
  it("strips identity headers + emits Bearer for api.anthropic.com.evil.test", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://api.anthropic.com.evil.test/v1" },
      },
      true
    );

    expect(headers["x-app"]).toBeUndefined();
    expect(headers["X-App"]).toBeUndefined();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(headers["Anthropic-Dangerous-Direct-Browser-Access"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer key");
  });

  it("strips identity headers for evil.test/?x=api.anthropic.com (substring in query)", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://evil.test/?x=api.anthropic.com" },
      },
      true
    );

    expect(headers["x-app"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer key");
  });

  it("keeps identity headers for the genuine official host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
      },
      true
    );

    expect(headers["Authorization"]).toBeUndefined();
    const hasVersion = headers["Anthropic-Version"] || headers["anthropic-version"];
    expect(hasVersion).toBeDefined();
  });

  it("keeps identity headers when baseUrl is empty (defaults to Anthropic)", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: {},
      },
      true
    );

    expect(headers["Authorization"]).toBeUndefined();
    const hasVersion = headers["Anthropic-Version"] || headers["anthropic-version"];
    expect(hasVersion).toBeDefined();
  });
});
