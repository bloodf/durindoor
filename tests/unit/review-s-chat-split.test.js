import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as chat from "../../src/sse/handlers/chat.js";

describe("chat handler module boundary", () => {
  it("preserves its public exports and stays within the line budget", () => {
    expect(Object.keys(chat).sort()).toEqual([
      "__resetAntigravity429StrikesForTests", "handleChat", "holdForEarlyEof",
      "isImageOnlyModel", "isNonChatModel", "rankComboModelsByLocks",
      "rankComboModelsByQuota", "resolveComboCapabilitiesMap", "resolveComboModelTimeoutMs",
      "warmRequestModelLimits"
    ].sort());
    expect(readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8").split("\n").length).toBeLessThan(600);
  });
});
