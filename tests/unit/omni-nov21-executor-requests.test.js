import { describe, expect, it } from "vitest";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { maskText } from "../../open-sse/services/contentMasking.js";

describe("Nov 21 executor request ports", () => {
  it("keeps the local Command Code CLI identity and credential ownership", () => {
    const headers = new CommandCodeExecutor().buildHeaders({ apiKey: "user_test" });
    expect(headers).toMatchObject({
      Authorization: "Bearer user_test",
      "x-command-code-version": "1.88.5",
      "x-cli-environment": "production",
      "x-cli-surface": "cli",
    });
    expect(headers.Authorization).not.toContain("accessToken");
  });

  it("masks long labelled assignments and query parameters", () => {
    const value = "Rk4pW9zQm2xt7vNb3";
    const counts = {};
    expect(maskText(`DB_PASSWORD=${value}; client_secret: ${value}; ?api_key=${value}`, {}, counts))
      .toBe("DB_PASSWORD=[REDACTED:secret]; client_secret: [REDACTED:secret]; ?api_key=[REDACTED:secret]");
    expect(counts.labelled_secret).toBe(3);
  });

  it("preserves short values, variable references, and placeholders", () => {
    const text = "password: required; api_key=$API_KEY; secret=${SECRET}; client_secret=[REDACTED:secret]; token=<placeholder>";
    expect(maskText(text)).toBe(text);
  });
});
