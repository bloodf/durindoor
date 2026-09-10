import { describe, expect, it } from "vitest";

import {
  buildConnectionNameMap,
  connectionDisplayName,
  shortConnectionId,
} from "@/shared/utils/connectionDisplay.js";

describe("connectionDisplay", () => {
  describe("shortConnectionId", () => {
    it("returns the first UUID segment", () => {
      expect(shortConnectionId("cde75bf1-0046-4710-abcd-1234567890ab")).toBe("cde75bf1");
    });

    it("truncates id-like values without a dash to 8 chars", () => {
      expect(shortConnectionId("fixture-connection")).toBe("fixture");
      expect(shortConnectionId("abcdefghij")).toBe("abcdefgh");
    });

    it("returns empty string for missing/invalid input", () => {
      expect(shortConnectionId("")).toBe("");
      expect(shortConnectionId(null)).toBe("");
      expect(shortConnectionId(undefined)).toBe("");
      expect(shortConnectionId(42)).toBe("");
    });
  });

  describe("buildConnectionNameMap", () => {
    it("maps ids to trimmed names", () => {
      const map = buildConnectionNameMap([
        { id: "a-1", name: "  Work Claude  " },
        { id: "b-2", name: "Personal" },
      ]);
      expect(map).toEqual({ "a-1": "Work Claude", "b-2": "Personal" });
    });

    it("skips unnamed, malformed, and non-object rows", () => {
      const map = buildConnectionNameMap([
        { id: "a-1", name: "" },
        { id: "b-2" },
        { name: "no id" },
        null,
        "junk",
      ]);
      expect(map).toEqual({});
    });

    it("tolerates a non-array payload", () => {
      expect(buildConnectionNameMap(undefined)).toEqual({});
      expect(buildConnectionNameMap({ connections: [] })).toEqual({});
    });
  });

  describe("connectionDisplayName", () => {
    const names = { "cde75bf1-0046-4710-abcd-1234567890ab": "Work Claude" };

    it("resolves a known id to its connection name", () => {
      expect(connectionDisplayName("cde75bf1-0046-4710-abcd-1234567890ab", names)).toBe("Work Claude");
    });

    it("falls back to the short id for unknown connections", () => {
      expect(connectionDisplayName("9f0e1d2c-1111-2222-3333-444444444444", names)).toBe("9f0e1d2c");
    });

    it("falls back to the short id when the map is missing", () => {
      expect(connectionDisplayName("9f0e1d2c-1111", undefined)).toBe("9f0e1d2c");
      expect(connectionDisplayName("9f0e1d2c-1111", null)).toBe("9f0e1d2c");
    });

    it("renders an em-dash placeholder when no id was recorded", () => {
      expect(connectionDisplayName("", names)).toBe("—");
      expect(connectionDisplayName(null, names)).toBe("—");
      expect(connectionDisplayName(undefined, names)).toBe("—");
    });
  });
});
