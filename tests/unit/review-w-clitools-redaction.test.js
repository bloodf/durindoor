import { describe, expect, it } from "vitest";
import { REDACTED_SECRET, preserveRedactedSecrets, redactSecrets } from "@/shared/utils/secretRedaction.js";

const secret = "host-secret-value";

describe("CLI tool settings redaction", () => {
  it("redacts tool environment, MCP headers, args and URL credentials across settings shapes", () => {
    const config = {
      env: {
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AWS_SESSION_TOKEN: "aws-session",
        AWS_BEARER_TOKEN_BEDROCK: "aws-bedrock",
        ANTHROPIC_CUSTOM_HEADERS: "anthropic-headers",
      },
      mcp: {
        server: {
          url: "https://alice:password@example.test/mcp",
          headers: { Authorization: "bearer-value", "X-Custom": "custom-value" },
          environment: { API_TOKEN: "environment-value" },
          args: ["--api-token=argument-value", "--password", "separate-value"],
        },
      },
    };

    const redacted = redactSecrets(config);
    for (const value of ["aws-secret", "aws-session", "aws-bedrock", "anthropic-headers", "alice", "bearer-value", "custom-value", "environment-value", "argument-value", "separate-value"]) {
      expect(JSON.stringify(redacted)).not.toContain(value);
    }
    expect(redacted.env.AWS_SESSION_TOKEN).toBe(REDACTED_SECRET);
    expect(redacted.mcp.server.url).toBe("https://[REDACTED]@example.test/mcp");
    expect(redacted.mcp.server.args).toEqual(["--api-token=[REDACTED]", "--password", "[REDACTED]"]);
  });

  it("keeps existing values when redacted fields are submitted back", () => {
    expect(preserveRedactedSecrets(
      { env: { AWS_SESSION_TOKEN: REDACTED_SECRET }, apiKey: REDACTED_SECRET },
      { env: { AWS_SESSION_TOKEN: "stored-session" }, apiKey: "stored-key" },
    )).toEqual({ env: { AWS_SESSION_TOKEN: "stored-session" }, apiKey: "stored-key" });
  });
});
