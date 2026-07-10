import { describe, expect, it } from "vitest";
import {
  parseBulkApiKeyLine,
  requiresProviderAccountId,
} from "../../src/lib/providerAccountIds.js";

describe("account-scoped provider input", () => {
  it("requires account IDs for Cloudflare and Snowflake", () => {
    expect(requiresProviderAccountId("cloudflare-ai")).toBe(true);
    expect(requiresProviderAccountId("snowflake")).toBe(true);
    expect(requiresProviderAccountId("openai")).toBe(false);
  });

  it.each(["cloudflare-ai", "snowflake"])("rejects %s bulk lines without accountId", (provider) => {
    expect(() => parseBulkApiKeyLine("name|sk-key", 0, provider)).toThrow(/name\|apiKey\|accountId/);
    expect(() => parseBulkApiKeyLine("name|sk-key|", 0, provider)).toThrow(/apiKey and accountId/);
  });

  it("parses an account-scoped line without losing pipe characters in the key", () => {
    expect(parseBulkApiKeyLine("prod|sk|segment|org_account", 1, "snowflake")).toEqual({
      name: "prod 2",
      apiKey: "sk|segment",
      providerSpecificData: { accountId: "org_account" },
    });
  });
});
