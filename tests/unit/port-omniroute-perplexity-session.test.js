import { describe, expect, it } from "vitest";
import { buildPerplexitySessionCookie } from "../../src/lib/providers/webCookieAuth.js";

describe("OmniRoute #21186 1c1b126b7c4ce6d61ec770a1b95ea3084fe656ab Perplexity cookies", () => {
  it("preserves current account and session cookies in a pasted header", () => {
    const value = "pplx.session-id=id; __Secure-pplx.session.12345678-1234-1234-1234-123456789abc=token; extra=yes";
    expect(buildPerplexitySessionCookie(`Cookie: ${value}`)).toBe(value);
  });
  it("retains legacy tokens and does not mistake a cookie value for a name", () => {
    expect(buildPerplexitySessionCookie("legacy-token")).toBe("__Secure-next-auth.session-token=legacy-token");
    expect(buildPerplexitySessionCookie("__Secure-next-auth.session-token.1=b; __Secure-next-auth.session-token.0=a")).toBe("__Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.1=b");
    expect(buildPerplexitySessionCookie("other=__Secure-pplx.session.12345678-1234-1234-1234-123456789abc=x; unrelated=y")).toBe("");
  });
});
