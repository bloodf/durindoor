import { describe, expect, it } from "vitest";
import { REDACTED_SECRET, redactSecrets } from "../../src/shared/utils/secretRedaction.js";

describe("management response secret redaction", () => {
  it("redacts common nested CLI credential fields without mutating the source", () => {
    const source = {
      env: { ANTHROPIC_AUTH_TOKEN: "sk-deadbeef", API_TIMEOUT_MS: "600000" },
      provider: { options: { apiKey: "sk-current", baseURL: "http://localhost" } },
      headers: { "x-9r-cli-token": "machine-token" },
      policy: { maxTokens: 500 },
      array: [{ password: "private", name: "safe" }],
    };

    expect(redactSecrets(source)).toEqual({
      env: { ANTHROPIC_AUTH_TOKEN: REDACTED_SECRET, API_TIMEOUT_MS: "600000" },
      provider: { options: { apiKey: REDACTED_SECRET, baseURL: "http://localhost" } },
      headers: { "x-9r-cli-token": REDACTED_SECRET },
      policy: { maxTokens: 500 },
      array: [{ password: REDACTED_SECRET, name: "safe" }],
    });
    expect(source.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-deadbeef");
  });
});
