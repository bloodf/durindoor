import { describe, expect, it } from "vitest";
import { canonicalizePolicyModelIdentity } from "../../src/sse/services/apiKeyPolicyIdentity.js";

describe("API-key policy runtime identities", () => {
  it("maps built-in aliases to the same canonical identity enforced by handlers", () => {
    expect(canonicalizePolicyModelIdentity("ag/gemini-test")).toBe("antigravity/gemini-test");
    expect(canonicalizePolicyModelIdentity("antigravity/gemini-test")).toBe("antigravity/gemini-test");
  });

  it("preserves operation suffixes while canonicalizing provider aliases", () => {
    expect(canonicalizePolicyModelIdentity("ag/search")).toBe("antigravity/search");
  });
});
