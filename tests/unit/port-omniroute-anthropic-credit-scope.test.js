import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const MESSAGE =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const envelope = (message, type = "invalid_request_error") => ({ type: "error", error: { type, message } });
const classify = (provider, body, text = JSON.stringify(body)) =>
  checkFallbackError({ status: 400, errorText: text, errorBody: body, structuredError: body, provider, model: "claude-sonnet-4-5" });

describe("OmniRoute #21076 (77b4f9efd236) Anthropic credit-balance 400 is account-level", () => {
  for (const provider of ["anthropic", "anthropic-compatible-abc123"]) {
    it(`parks the whole ${provider} connection`, () => {
      expect(classify(provider, envelope(MESSAGE))).toMatchObject({ shouldFallback: true, terminal: true, scope: "connection" });
      expect(classify(provider, envelope(MESSAGE, "billing_error")).scope).toBe("connection");
    });
  }

  it("accepts the bare message, with or without the status prefix", () => {
    for (const text of [MESSAGE, `[400]: ${MESSAGE}`]) {
      expect(checkFallbackError(400, text, 0, "anthropic").scope, text).toBe("connection");
    }
  });

  it("ignores a 400 that only quotes the phrase mid-message", () => {
    const echoed = envelope("Unknown parameter: 'your credit balance is too low'");
    expect(classify("anthropic-compatible-abc123", echoed).scope).not.toBe("connection");
  });

  it("leaves other providers and other statuses unchanged", () => {
    expect(classify("openai-compatible-zzz", envelope(MESSAGE)).scope).not.toBe("connection");
    expect(checkFallbackError(429, MESSAGE, 0, "anthropic").scope).not.toBe("connection");
  });
});
