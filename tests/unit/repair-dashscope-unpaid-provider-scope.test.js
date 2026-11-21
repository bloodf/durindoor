import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("DashScope unpaid-account fallback", () => {
  it.each([
    ["claude", { type: "invalid_request_error", message: 'Invalid content: "arrearage"' }],
    ["claude", { type: "invalid_request_error", message: "Invalid parameter", param: "AccessDenied.Unpurchased" }],
    ["openai", { message: 'Invalid content: "AccessDenied.Unpurchased"' }],
    ["openai", { message: "Invalid parameter", param: "arrearage" }],
    ["openai", { code: "Arrearage", message: "Invalid parameter" }],
    ["alibaba-cn", { message: 'Invalid content: "Arrearage"', param: "AccessDenied.Unpurchased" }],
    ["alibaba-cn", { code: "Invalid.Arrearage", message: "Invalid parameter" }],
  ])("keeps %s request failures request-scoped (%j)", (provider, error) => {
    const body = { error };
    const result = checkFallbackError(400, JSON.stringify(body), 0, provider, null, body);

    expect(result).toMatchObject({ shouldFallback: false, requestScoped: true, cooldownMs: 0 });
    expect(result.terminal).toBeUndefined();
  });

  it.each([
    "alibaba-cn",
    "alibaba",
    "alicode",
    "alicode-intl",
    "bailian-coding-plan",
    "qwen-cloud",
    "qwen-cloud-token-plan",
  ])("parks a %s account on a structured Arrearage code", (provider) => {
    const body = { error: { code: "Arrearage", message: "Access denied" } };
    const result = checkFallbackError(400, "Access denied", 0, provider, null, body);

    expect(result).toMatchObject({ shouldFallback: true, terminal: true, cooldownMs: 120_000 });
    expect(result.requestScoped).toBeUndefined();
  });
});
