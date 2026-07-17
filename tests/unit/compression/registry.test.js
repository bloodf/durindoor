import { describe, expect, it, beforeAll } from "vitest";
import {
  registerBuiltinEngines,
  registerBuiltinCompressionEngines,
  getEngine,
  getCompressionEngine,
  isEngineAvailable,
  ENGINE_IDS,
} from "../../../open-sse/services/compression/index.js";

describe("compression registry (F-1a)", () => {
  beforeAll(() => registerBuiltinEngines());

  it("resolves the three shipped engines by id", () => {
    expect(getEngine("session-dedup").id).toBe("session-dedup");
    expect(getEngine("headroom").id).toBe("headroom");
    expect(getEngine("caveman").id).toBe("caveman");
  });

  it("getCompressionEngine is an alias for getEngine", () => {
    expect(getCompressionEngine("caveman")).toBe(getEngine("caveman"));
  });

  it("catalog availability matches what is actually shipped", () => {
    expect(isEngineAvailable("session-dedup")).toBe(true);
    expect(isEngineAvailable("headroom")).toBe(true);
    expect(isEngineAvailable("caveman")).toBe(true);
    // Metadata-only placeholders: named by the catalog but not dispatchable.
    for (const id of ["ccr", "lite", "rtk", "relevance", "aggressive", "llmlingua", "ultra"]) {
      expect(isEngineAvailable(id)).toBe(false);
    }
  });

  it("ENGINE_IDS is sorted by ascending stackPriority", () => {
    expect(ENGINE_IDS).toEqual([
      "session-dedup",
      "ccr",
      "lite",
      "rtk",
      "headroom",
      "relevance",
      "caveman",
      "aggressive",
      "llmlingua",
      "ultra",
    ]);
  });

  it("throws on unknown and on unavailable-but-cataloged ids", () => {
    expect(() => getEngine("does-not-exist")).toThrow(/Unknown compression engine: does-not-exist/);
    expect(() => getEngine("llmlingua")).toThrow(/Unknown compression engine: llmlingua/);
    expect(() => getEngine("ultra")).toThrow(/Unknown compression engine: ultra/);
  });

  it("normalizes native-sync engine.apply to a Promise", async () => {
    const cv = getEngine("caveman");
    const pending = cv.apply(
      { model: "gpt-4", messages: [{ role: "user", content: "please kindly explain" }] },
      { stepConfig: { enabled: true, intensity: "full" } }
    );
    expect(pending).toBeInstanceOf(Promise);
    const result = await pending;
    expect(result).toHaveProperty("body");
    expect(result).toHaveProperty("compressed");
  });

  it("registerBuiltinCompressionEngines aliases registerBuiltinEngines", () => {
    expect(registerBuiltinCompressionEngines).toBe(registerBuiltinEngines);
  });
});
