/**
 * Regression tests for upstream decolua/9router PR #2345
 * ("fix(codex): parse reset credit expiry details", head 465e3e52b7).
 * Ports the observable contracts of the upstream patch: multi-shape reset
 * credit parsing, expiry extraction, and filtering of consumed/expired credits.
 */
import { describe, it, expect } from "vitest";
import {
  parseCodexResetCredits,
  getCodexAccountId,
} from "../../open-sse/services/usage/codex.js";

describe("port-2345: codex reset credit expiry parsing", () => {
  it("returns zero state for non-object input", () => {
    expect(parseCodexResetCredits(null)).toEqual({ availableCount: 0, credits: [] });
    expect(parseCodexResetCredits(undefined)).toEqual({ availableCount: 0, credits: [] });
    expect(parseCodexResetCredits([1, 2])).toEqual({ availableCount: 0, credits: [] });
    expect(parseCodexResetCredits("bad")).toEqual({ availableCount: 0, credits: [] });
  });

  it("extracts expiry from multiple field names", () => {
    const source = {
      available_count: 4,
      credits: [
        { status: "available", expires_at: "2026-08-01T00:00:00Z" },
        { status: "available", expiresAt: "2026-08-02T00:00:00Z" },
        { status: "available", expiration_time: "2026-08-03T00:00:00Z" },
        { status: "available", valid_until: "2026-08-04T00:00:00Z" },
      ],
    };
    const result = parseCodexResetCredits(source);
    expect(result.availableCount).toBe(4);
    expect(result.credits).toHaveLength(4);
    expect(result.credits[0].expiresAt).toBe("2026-08-01T00:00:00.000Z");
    expect(result.credits[1].expiresAt).toBe("2026-08-02T00:00:00.000Z");
    expect(result.credits[2].expiresAt).toBe("2026-08-03T00:00:00.000Z");
    expect(result.credits[3].expiresAt).toBe("2026-08-04T00:00:00.000Z");
  });

  it("drops consumed/redeemed/expired credits from the available list", () => {
    const source = {
      available_count: 1,
      credits: [
        { status: "available", expires_at: "2026-08-01T00:00:00Z" },
        { status: "redeemed", expires_at: "2026-08-02T00:00:00Z" },
        { status: "expired", expires_at: "2026-08-03T00:00:00Z" },
        { used_at: "2026-07-01T00:00:00Z", expires_at: "2026-08-04T00:00:00Z" },
      ],
    };
    const result = parseCodexResetCredits(source);
    expect(result.availableCount).toBe(1);
    expect(result.credits).toHaveLength(1);
    expect(result.credits[0].status).toBe("available");
  });

  it("slices credits down to declared available count", () => {
    const source = {
      available_count: 1,
      credits: [
        { status: "available", expires_at: "2026-08-01T00:00:00Z" },
        { status: "available", expires_at: "2026-08-02T00:00:00Z" },
      ],
    };
    const result = parseCodexResetCredits(source);
    expect(result.availableCount).toBe(1);
    expect(result.credits).toHaveLength(1);
  });

  it("accepts alternative array keys (grants/items/availableCredits)", () => {
    const r1 = parseCodexResetCredits({ available_count: 1, grants: [{ status: "available" }] });
    const r2 = parseCodexResetCredits({ available_count: 1, items: [{ status: "available" }] });
    const r3 = parseCodexResetCredits({ available_count: 1, availableCredits: [{ status: "available" }] });
    expect(r1.credits).toHaveLength(1);
    expect(r2.credits).toHaveLength(1);
    expect(r3.credits).toHaveLength(1);
  });

  it("maps credit id, index, type, grantedAt", () => {
    const result = parseCodexResetCredits({
      credits: [{
        id: "cr_123",
        status: "available",
        granted_at: "2026-07-01T12:00:00Z",
        expires_at: "2026-08-01T00:00:00Z",
        type: "rate_limit_reset",
      }],
    });
    expect(result.credits[0]).toMatchObject({
      id: "cr_123",
      index: 0,
      status: "available",
      grantedAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      type: "rate_limit_reset",
    });
  });

  it("falls back to credits.length when count field missing", () => {
    const result = parseCodexResetCredits({
      credits: [{ status: "available" }, { status: "available" }],
    });
    expect(result.availableCount).toBe(2);
  });
});

describe("port-2345: codex account-id resolution", () => {
  it("prefers workspaceId over chatgptAccountId and accountId", () => {
    expect(getCodexAccountId({
      workspaceId: "ws_1",
      chatgptAccountId: "gpt_2",
      accountId: "acc_3",
    })).toBe("ws_1");
    expect(getCodexAccountId({ chatgptAccountId: "gpt_2", accountId: "acc_3" })).toBe("gpt_2");
    expect(getCodexAccountId({ accountId: "acc_3" })).toBe("acc_3");
  });

  it("trims whitespace and rejects non-string values", () => {
    expect(getCodexAccountId({ workspaceId: "  ws_trimmed  " })).toBe("ws_trimmed");
    expect(getCodexAccountId({ workspaceId: 12345 })).toBe("");
    expect(getCodexAccountId({})).toBe("");
    expect(getCodexAccountId()).toBe("");
  });

  it("rejects values with CRLF/NUL (dev hardening over upstream)", () => {
    expect(getCodexAccountId({ workspaceId: "ws\ninjected" })).toBe("");
    expect(getCodexAccountId({ workspaceId: "ws\rcarriage" })).toBe("");
    expect(getCodexAccountId({ workspaceId: "ws\0null" })).toBe("");
  });

  it("rejects over-long account ids (dev hardening)", () => {
    expect(getCodexAccountId({ workspaceId: "x".repeat(256) })).toBe("x".repeat(256));
    expect(getCodexAccountId({ workspaceId: "x".repeat(257) })).toBe("");
  });
});
