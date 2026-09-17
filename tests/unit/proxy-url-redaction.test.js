import { describe, expect, it } from "vitest";
import {
  REDACTED_PROXY_CREDENTIAL,
  redactProxyUrlCredentials,
} from "../../src/shared/utils/proxyUrlRedaction.js";

describe("redactProxyUrlCredentials", () => {
  it("removes userinfo while keeping the endpoint readable", () => {
    const result = redactProxyUrlCredentials("http://proxyuser:s3cret@proxy.internal:8080");

    expect(result).not.toContain("s3cret");
    expect(result).not.toContain("proxyuser");
    expect(result).toContain("proxy.internal:8080");
  });

  it("redacts a password-only and a username-only credential", () => {
    expect(redactProxyUrlCredentials("http://:s3cret@proxy.internal")).not.toContain("s3cret");
    expect(redactProxyUrlCredentials("http://proxyuser@proxy.internal")).not.toContain("proxyuser");
  });

  it("returns a credential-free URL unchanged", () => {
    const plain = "http://proxy.internal:8080/";
    expect(redactProxyUrlCredentials(plain)).toBe(plain);
  });

  it("fully redacts a value that does not parse as a URL", () => {
    // An unparsable string may still embed credentials, so it is never echoed.
    expect(redactProxyUrlCredentials("proxyuser:s3cret@not a url")).toBe(REDACTED_PROXY_CREDENTIAL);
  });

  it("passes through empty and non-string values", () => {
    expect(redactProxyUrlCredentials("")).toBe("");
    expect(redactProxyUrlCredentials(undefined)).toBe(undefined);
    expect(redactProxyUrlCredentials(null)).toBe(null);
  });
});
