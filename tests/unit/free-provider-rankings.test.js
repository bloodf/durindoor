import { describe, expect, it } from "vitest";
import {
  classifyProvider,
  computeFreeProviderRankings,
} from "../../open-sse/services/freeProviderRankings.js";

describe("freeProviderRankings", () => {
  it("classifies noAuth providers as noauth", () => {
    const cls = classifyProvider({ id: "local", noAuth: true, category: "apikey", transport: { baseUrl: "x" }, models: [] });
    expect(cls?.category).toBe("noauth");
  });

  it("classifies category free/freeTier providers", () => {
    expect(classifyProvider({ id: "a", category: "free", transport: {}, models: [] })?.category).toBe("free");
    expect(classifyProvider({ id: "b", category: "freeTier", transport: {}, models: [] })?.category).toBe("freeTier");
  });

  it("includes registry category \"free\" providers (gemini-cli/kiro/qoder)", () => {
    const rows = computeFreeProviderRankings({ category: "free" });
    // The registry ships category:"free" providers; the category filter must
    // not silently drop them.
    expect(rows.every((r) => r.category === "free")).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("emits null intelligence fields — never fabricates quality", () => {
    const rows = computeFreeProviderRankings({ limit: 5 });
    for (const r of rows) {
      expect(r.topModel).toBeNull();
      expect(r.averageScore).toBeNull();
    }
  });

  it("orders deterministically by category then provider id", () => {
    const rows = computeFreeProviderRankings({ limit: 100 });
    const rank = { noauth: 0, free: 1, freeTier: 1, oauth: 2, apikey: 3 };
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const cp = rank[prev.category] ?? 9;
      const cc = rank[cur.category] ?? 9;
      if (cp !== cc) {
        expect(cp).toBeLessThan(cc);
      } else {
        expect(prev.id <= cur.id).toBe(true);
      }
    }
  });

  it("category filter restricts results", () => {
    const rows = computeFreeProviderRankings({ category: "oauth" });
    expect(rows.every((r) => r.category === "oauth")).toBe(true);
  });

  it("rows expose id + name + modelCount used by the dashboard", () => {
    const rows = computeFreeProviderRankings({ limit: 3 });
    for (const r of rows) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.name).toBe("string");
      expect(typeof r.modelCount).toBe("number");
    }
  });
});
