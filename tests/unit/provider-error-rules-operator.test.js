import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getProviderErrorRuleMatch,
  hasOperatorRuleForProvider,
  resolveRuleMatchBody,
  setOperatorProviderErrorRules,
} from "../../open-sse/config/providerErrorRules.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

// OmniRoute #11104, adapted: operators declare per-provider error rules
// through settings.providerErrorRules instead of patching the built-in
// catalog. Matches are plain case-insensitive substrings, never RegExp, so
// an operator pattern can never introduce a ReDoS on the classification hot
// path (open-sse/config/providerErrorRules.js).
describe("#11104 — operator-declared provider error rules", () => {
  afterEach(() => {
    setOperatorProviderErrorRules(null);
  });

  it("is consulted before the built-in registry and wins", () => {
    setOperatorProviderErrorRules({
      customprovider: [{ status: 429, match: "daily cap hit", scope: "connection", cooldownMs: 60_000 }],
    });
    expect(hasOperatorRuleForProvider("customprovider")).toBe(true);
    const match = getProviderErrorRuleMatch("customprovider", 429, null, "Error: daily cap hit, try later");
    expect(match).toEqual({ reason: "quota_exhausted", scope: "connection", cooldownMs: 60_000 });
  });

  it("does nothing for a provider with no declared rule", () => {
    setOperatorProviderErrorRules({ customprovider: [{ status: 429, match: "cap", scope: "model" }] });
    expect(getProviderErrorRuleMatch("otherprovider", 429, null, "cap hit")).toBeNull();
  });

  it("requires both the status and the substring to match", () => {
    setOperatorProviderErrorRules({
      customprovider: [{ status: 429, match: "daily cap hit", scope: "connection" }],
    });
    expect(getProviderErrorRuleMatch("customprovider", 500, null, "daily cap hit")).toBeNull();
    expect(getProviderErrorRuleMatch("customprovider", 429, null, "unrelated error")).toBeNull();
  });

  it("matches case-insensitively as a literal substring, never as a regex", () => {
    setOperatorProviderErrorRules({
      customprovider: [{ status: 429, match: "Rate.Limit(5)", scope: "model" }],
    });
    // A regex engine would treat "." and "(" as metacharacters; a substring
    // matcher must require this exact literal text.
    expect(getProviderErrorRuleMatch("customprovider", 429, null, "hit RATE.LIMIT(5) today")).toMatchObject({
      scope: "model",
    });
    expect(getProviderErrorRuleMatch("customprovider", 429, null, "hit RateXLimit_5_ today")).toBeNull();
  });

  it("flows through checkFallbackError end to end for a quota_exhausted reason", () => {
    setOperatorProviderErrorRules({
      customprovider: [{ status: 403, match: "no quota left", scope: "connection" }],
    });
    const result = checkFallbackError(403, "no quota left", 0, "customprovider", null, "no quota left");
    expect(result.shouldFallback).toBe(true);
    expect(result.scope).toBe("connection");
  });

  it("resolveRuleMatchBody returns the raw error text only when an operator rule exists", () => {
    setOperatorProviderErrorRules({ customprovider: [{ status: 429, match: "x", scope: "model" }] });
    expect(resolveRuleMatchBody("customprovider", { some: "structured" }, "raw text")).toBe("raw text");
    expect(resolveRuleMatchBody("unrelated", { some: "structured" }, "raw text")).toEqual({ some: "structured" });
  });

  it("drops malformed rules defensively and caps at 50 total", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ status: 429, match: `<<${i}>>`, scope: "model" }));
    setOperatorProviderErrorRules({
      bad: [{ status: "not-a-number", match: "x", scope: "model" }, { status: 429, match: "", scope: "model" }],
      many: many,
    });
    expect(hasOperatorRuleForProvider("bad")).toBe(false);
    // Only the first 50 of the 60 declared rules for "many" are kept.
    expect(getProviderErrorRuleMatch("many", 429, null, "<<0>>")).not.toBeNull();
    expect(getProviderErrorRuleMatch("many", 429, null, "<<59>>")).toBeNull();
  });

  it("clearing with null/empty removes every operator rule", () => {
    setOperatorProviderErrorRules({ customprovider: [{ status: 429, match: "x", scope: "model" }] });
    expect(hasOperatorRuleForProvider("customprovider")).toBe(true);
    setOperatorProviderErrorRules(null);
    expect(hasOperatorRuleForProvider("customprovider")).toBe(false);
  });

  it("does not interfere with the built-in agentrouter rules when unset", () => {
    const body = { error: { message: "用户额度不足", type: "quota_exhausted" } };
    expect(checkFallbackError(400, "Forbidden", 0, "agentrouter", null, body)).toMatchObject({
      shouldFallback: true,
      scope: "connection",
    });
  });
});
