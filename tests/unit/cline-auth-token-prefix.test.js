/**
 * Upstream f6e7cabe — ClinePass API keys must not be `workos:`-prefixed.
 *
 * Cline OAuth access tokens are WorkOS JWTs the API only accepts as
 * `workos:<jwt>`. ClinePass API keys (`clp_…`) are opaque and accepted
 * verbatim; prefixing them makes api.cline.bot answer HTTP 401.
 */
import { describe, it, expect } from "vitest";

import {
  getClineAccessToken,
  getClineAuthorizationHeader,
  buildClineHeaders
} from "../../open-sse/shared/clineAuth.js";

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1XzEifQ.sig";

describe("getClineAccessToken", () => {
  it("prefixes a bare WorkOS JWT", () => {
    expect(getClineAccessToken(JWT)).toBe(`workos:${JWT}`);
  });

  it("never doubles an existing prefix, case-insensitively", () => {
    expect(getClineAccessToken(`workos:${JWT}`)).toBe(`workos:${JWT}`);
    expect(getClineAccessToken(`WorkOS:${JWT}`)).toBe(`WorkOS:${JWT}`);
    expect(getClineAccessToken(`  workos:${JWT}  `)).toBe(`workos:${JWT}`);
  });

  it("sends ClinePass API keys verbatim", () => {
    expect(getClineAccessToken("clp_1234567890abcdef")).toBe("clp_1234567890abcdef");
    expect(getClineAccessToken("  clp_abc  ")).toBe("clp_abc");
    expect(getClineAccessToken("sk-9r-abcdef")).toBe("sk-9r-abcdef");
  });

  it("returns empty string for unusable input", () => {
    for (const bad of ["", "   ", undefined, null, 42, {}]) {
      expect(getClineAccessToken(bad)).toBe("");
    }
  });
});

describe("cline authorization header", () => {
  it("bearers the API key without a prefix and the JWT with one", () => {
    expect(getClineAuthorizationHeader("clp_abc")).toBe("Bearer clp_abc");
    expect(getClineAuthorizationHeader(JWT)).toBe(`Bearer workos:${JWT}`);
    expect(getClineAuthorizationHeader("")).toBe("");
  });

  it("omits Authorization entirely when there is no usable token", () => {
    expect(buildClineHeaders("")).not.toHaveProperty("Authorization");
    expect(buildClineHeaders("clp_abc").Authorization).toBe("Bearer clp_abc");
  });
});
