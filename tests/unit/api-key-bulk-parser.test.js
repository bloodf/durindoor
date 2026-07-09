// Tests for the pure bulk-row parser extracted from AddApiKeyModal.
// Bug-fix scope: bulk rows for requiresAccountId providers (Cloudflare Workers
// AI, Snowflake Cortex) must require a non-empty final accountId. Invalid rows
// must NOT be POSTed — they should be counted failed in the bulk submit loop.
import { describe, it, expect } from "vitest";
import { parseBulkKeyRow } from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyBulk.js";

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