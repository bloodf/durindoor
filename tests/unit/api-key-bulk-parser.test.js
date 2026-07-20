// Tests for the pure bulk-row parser extracted from AddApiKeyModal.
// Bug-fix scope: bulk rows for requiresAccountId providers (Cloudflare Workers
// AI, Snowflake Cortex) must require a non-empty final accountId. Invalid rows
// must NOT be POSTed — they should be counted failed in the bulk submit loop.
import { describe, it, expect } from "vitest";
import {
  parseBulkKeyRow,
  prepareBulkKeyRows,
  getBulkGuidance,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyBulk.js";

import { getAccountIdProviderData, isAccountIdValid, getProviderHelp } from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyBulk.js";

describe("single-entry accountId validation", () => {
  it("rejects whitespace and trims accepted account IDs", () => {
    expect(isAccountIdValid("   ")).toBe(false);
    expect(getAccountIdProviderData("  account-1  ")).toEqual({ accountId: "account-1" });
    expect(getAccountIdProviderData("   ")).toBeUndefined();
  });
});

describe("provider help", () => {
  it("uses Snowflake-specific help instead of Cloudflare copy", () => {
    expect(getProviderHelp("snowflake")).toMatchObject({ href: expect.stringContaining("snowflake") });
    expect(getProviderHelp("snowflake").text).not.toContain("Cloudflare");
    expect(getProviderHelp("cloudflare-ai").text).toContain("Cloudflare");
  });
});

describe("getBulkGuidance", () => {
  // Contract: the SAME requiresAccountId flag that gates row validation must
  // also gate the bulk format + placeholder. A requiresAccountId provider
  // (Snowflake Cortex, Cloudflare Workers AI) can never accept a key-only row,
  // so its guidance MUST advertise only accountId-bearing shapes and MUST NOT
  // present a key-only/auto-named example. Helper returns plain fields; the
  // modal renders them as real JSX so no raw <code> string is ever printed.

  describe("requiresAccountId providers (cloudflare-ai, snowflake)", () => {
    it("reports the name|apiKey|accountId format and disallows key-only", () => {
      const { format, allowsKeyOnly } = getBulkGuidance({ requiresAccountId: true });
      expect(format).toBe("name|apiKey|accountId");
      expect(allowsKeyOnly).toBe(false);
    });

    it("placeholder contains only accountId-bearing rows (no key-only row)", () => {
      const { placeholder } = getBulkGuidance({ requiresAccountId: true });
      const lines = placeholder.split("\n");
      // Every example row must carry the trailing accountId segment.
      for (const line of lines) {
        expect(line.split("|").length).toBeGreaterThanOrEqual(3);
      }
      expect(placeholder).toMatch(/\|acc|\|def|\|ghi/);
      // The legacy key-only auto-named row must not appear.
      expect(placeholder).not.toContain("sk-key-only-auto-named");
    });

    it("is driven by the same flag for any account-ID-required provider", () => {
      // Snowflake and Cloudflare share the flag; guidance must be identical
      // shape-wise regardless of which provider string is in play, because the
      // decision is requiresAccountId, not the provider id.
      const a = getBulkGuidance({ requiresAccountId: true });
      const b = getBulkGuidance({ requiresAccountId: true, provider: "snowflake" });
      expect(a).toEqual(b);
    });
  });

  describe("standard providers (no accountId required)", () => {
    it("reports name|apiKey format and allows key-only rows", () => {
      const { format, allowsKeyOnly } = getBulkGuidance({ requiresAccountId: false });
      expect(format).toBe("name|apiKey");
      expect(allowsKeyOnly).toBe(true);
    });

    it("retains the existing placeholder including the key-only auto-named row", () => {
      const { placeholder } = getBulkGuidance({ requiresAccountId: false });
      expect(placeholder).toContain("name1|sk-key1");
      expect(placeholder).toContain("name2|sk-key2");
      expect(placeholder).toContain("sk-key-only-auto-named");
    });

    it("default call (no opts) matches the ordinary-provider behavior", () => {
      expect(getBulkGuidance()).toEqual(getBulkGuidance({ requiresAccountId: false }));
    });
  });
});

describe("parseBulkKeyRow", () => {
  describe("standard providers (no accountId required)", () => {
    it("parses name|apiKey into a usable row", () => {
      const result = parseBulkKeyRow("prod|sk-abc123", { index: 0 });
      expect(result).toEqual({
        ok: true,
        name: "prod 1",
        apiKey: "sk-abc123",
      });
    });

    it("parses apiKey-only into an auto-named row", () => {
      const result = parseBulkKeyRow("sk-only", { index: 2 });
      expect(result).toEqual({
        ok: true,
        name: "Key 3",
        apiKey: "sk-only",
      });
    });

    it("uses defaultName when name segment is empty", () => {
      const result = parseBulkKeyRow("|sk-abc", { index: 0 });
      expect(result.ok).toBe(true);
      expect(result.apiKey).toBe("sk-abc");
      expect(result.name.startsWith("Key ")).toBe(true);
    });

    it("rejects an empty apiKey", () => {
      const result = parseBulkKeyRow("prod|", { index: 0 });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/apiKey/);
    });
  });

  describe("requiresAccountId providers (cloudflare-ai, snowflake)", () => {
    it("parses name|apiKey|accountId and exposes accountId as providerSpecificData", () => {
      const result = parseBulkKeyRow(
        "prod|sk-abc123|acc123456",
        { index: 0, requiresAccountId: true }
      );
      expect(result).toEqual({
        ok: true,
        name: "prod 1",
        apiKey: "sk-abc123",
        providerSpecificData: { accountId: "acc123456" },
      });
    });

    it("rejects rows that are missing the accountId segment (only name|apiKey)", () => {
      const result = parseBulkKeyRow(
        "prod|sk-abc123",
        { index: 0, requiresAccountId: true }
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/accountId/);
    });

    it("rejects rows where the accountId segment is whitespace-only", () => {
      const result = parseBulkKeyRow(
        "prod|sk-abc123|   ",
        { index: 0, requiresAccountId: true }
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/accountId/);
    });

    it("rejects rows where the accountId segment is an empty string", () => {
      const result = parseBulkKeyRow(
        "prod|sk-abc123|",
        { index: 0, requiresAccountId: true }
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/accountId/);
    });

    it("rejects rows where the apiKey segment is empty (with accountId present)", () => {
      const result = parseBulkKeyRow(
        "prod||acc123456",
        { index: 0, requiresAccountId: true }
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/apiKey/);
    });

    it("rejects a single-segment row for requiresAccountId providers", () => {
      const result = parseBulkKeyRow(
        "sk-only",
        { index: 0, requiresAccountId: true }
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/accountId/);
    });
  });

  describe("defensive cases", () => {
    it("rejects a non-string input", () => {
      const result = parseBulkKeyRow(undefined, { index: 0 });
      expect(result.ok).toBe(false);
    });

    it("rejects an empty string", () => {
      const result = parseBulkKeyRow("", { index: 0 });
      expect(result.ok).toBe(false);
    });
  });
});

describe("prepareBulkKeyRows", () => {
  describe("requiresAccountId providers (cloudflare-ai, snowflake)", () => {
    it("excludes rows missing an accountId segment and reports 2 failures for a mixed batch", () => {
      // Mixed batch: one valid row, one row missing the accountId segment,
      // one row with a blank accountId. Only the valid row should be eligible
      // for POST; the two invalid rows must be counted as failed up-front and
      // never reach fetch.
      const lines = [
        "prod|sk-valid-1|abc123",   // valid
        "missing|sk-no-account",     // missing accountId segment
        "blank|sk-blank|   ",        // blank accountId
      ];

      const result = prepareBulkKeyRows(lines, { requiresAccountId: true });

      expect(result.failed).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        name: "prod 1",
        apiKey: "sk-valid-1",
        providerSpecificData: { accountId: "abc123" },
      });
    });

    it("preserves the pipe character inside apiKey for valid rows", () => {
      const lines = ["prod|sk-a|sk-b|acc-1"];
      const result = prepareBulkKeyRows(lines, { requiresAccountId: true });
      expect(result.failed).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].apiKey).toBe("sk-a|sk-b");
      expect(result.items[0].providerSpecificData.accountId).toBe("acc-1");
    });

    it("reports zero failures for an empty input", () => {
      const result = prepareBulkKeyRows([], { requiresAccountId: true });
      expect(result.failed).toBe(0);
      expect(result.items).toEqual([]);
    });

    it("accepts a row with an empty name segment and auto-names it", () => {
      // Empty first segment falls back to defaultName; apiKey + accountId are
      // intact, so the row is valid and eligible for POST.
      const lines = ["|sk-key|acc-1"];
      const result = prepareBulkKeyRows(lines, { requiresAccountId: true });
      // The first segment is empty after trim, but auto-naming via defaultName
      // is acceptable; the row should still pass with name "Key 1".
      expect(result.failed).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Key 1");
      expect(result.items[0].providerSpecificData.accountId).toBe("acc-1");
    });
  });

  describe("standard providers (no accountId required)", () => {
    it("accepts valid rows and does not add providerSpecificData", () => {
      const lines = ["prod|sk-abc", "sk-only"];
      const result = prepareBulkKeyRows(lines, { requiresAccountId: false });
      expect(result.failed).toBe(0);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({ name: "prod 1", apiKey: "sk-abc" });
      expect(result.items[1]).toEqual({ name: "Key 2", apiKey: "sk-only" });
    });

    it("counts rows with empty apiKey as failed", () => {
      const lines = ["prod|"];
      const result = prepareBulkKeyRows(lines, { requiresAccountId: false });
      expect(result.failed).toBe(1);
      expect(result.items).toEqual([]);
    });
  });
});
