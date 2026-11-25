import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const decide = (body, provider = "openai-compatible-pool") => checkFallbackError({
  status: 400,
  errorText: typeof body === "string" ? body : JSON.stringify(body),
  provider,
  model: "claude-sonnet-4-5",
});

describe("9router #4439 - per-key credit exhaustion on HTTP 400 rotates the account", () => {
  it.each([
    ["the insufficient_user_quota code", { error: { message: "user quota is not enough", type: "api_error", code: "insufficient_user_quota" } }],
    ["an out-of-funds message", { error: { message: "You have run out of funds", type: "api_error" } }],
    ["a plain-text out-of-funds body", "out of funds"],
    ["a depleted extra-usage bucket", "You are out of extra usage"],
  ])("falls back on %s", (_label, body) => {
    expect(decide(body)).toMatchObject({ shouldFallback: true, terminal: true });
  });

  it("falls back when Anthropic types the depleted extra-usage bucket as invalid_request_error", () => {
    const body = { type: "error", error: { type: "invalid_request_error", message: "You're out of extra usage. Add more at claude.ai/settings/usage and keep going." } };

    expect(decide(body, "claude")).toMatchObject({ shouldFallback: true, terminal: true });
  });

  it.each([
    ["an ordinary malformed request", { error: { message: "messages: field required", type: "invalid_request_error" } }],
    ["a context overflow", { error: { message: "This model's maximum context length is 200000 tokens", code: "context_length_exceeded" } }],
    ["a billing phrase quoted outside the message", { error: { type: "invalid_request_error", message: "bad value for prompt", param: "out of funds" } }],
  ])("keeps %s on the request", (_label, body) => {
    expect(decide(body).shouldFallback).toBe(false);
  });
});
