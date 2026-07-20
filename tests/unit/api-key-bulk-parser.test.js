// Tests for the pure bulk-row parser extracted from AddApiKeyModal.
// Bug-fix scope: bulk rows for requiresAccountId providers (Cloudflare Workers
// AI, Snowflake Cortex) must require a non-empty final accountId. Invalid rows
// must NOT be POSTed — they should be counted failed in the bulk submit loop.
import { describe, it, expect } from "vitest";
import { parseBulkKeyRow, prepareBulkKeyRows } from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyBulk.js";

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

    it("counts a row whose only segment is empty as failed", () => {
      // Defensive: a row that survives .filter(Boolean) (e.g. contains a
      // whitespace-only segment) must still be excluded.
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
