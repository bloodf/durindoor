import { describe, expect, it } from "vitest";
import { normalizeCustomCapabilities } from "../../src/lib/db/repos/aliasRepo.js";

describe("custom capability defaultEffort", () => {
  it.each(["low", "medium", "high", "xhigh", "max", null])("accepts and stores %s", (value) => {
    expect(normalizeCustomCapabilities({ defaultEffort: value })).toEqual({ ok: true, caps: { defaultEffort: value } });
  });

  it.each(["turbo", 123, {}, ""])("rejects %j instead of silently dropping it", (value) => {
    expect(normalizeCustomCapabilities({ defaultEffort: value }).ok).toBe(false);
  });
});
