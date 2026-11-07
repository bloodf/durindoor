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

  it.each(["LLM|1412752987604207|PYVRCdb9ZAnsZZk63R", "llm|1412752987604207|PYVRCdb9ZAnsZZk63R"])(
    "keeps %s whole as the apiKey",
    (line) => {
      expect(parseBulkApiKeyLine(line, 0, "openai")).toEqual({ name: "LLM 1", apiKey: line, providerSpecificData: undefined });
    }
  );

  it.each([
    ["LLM|sk-abc", "LLM 1", "sk-abc"],
    ["LLM|", "LLM 1", ""],
  ])("does not treat %s as an opaque token", (line, name, key) => {
    if (!key) return expect(() => parseBulkApiKeyLine(line, 0, "openai")).toThrow();
    expect(parseBulkApiKeyLine(line, 0, "openai")).toMatchObject({ name, apiKey: key });
  });

  it("still parses name|key|accountId for account-scoped providers", () => {
    expect(parseBulkApiKeyLine("LLM|sk-key|acc123", 0, "snowflake").providerSpecificData).toEqual({ accountId: "acc123" });
  });
});
