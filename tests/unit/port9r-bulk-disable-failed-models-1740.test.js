import { describe, expect, it, vi } from "vitest";
import {
  testAndDisableFailedModels,
  bulkDisableMessage,
} from "../../src/shared/utils/providerModelBulkActions.js";

describe("port 9router #1740: bulk test & disable failed provider models", () => {
  it("disables only models whose probe outcome is error", async () => {
    const outcomes = { a: "ok", b: "error", c: "skipped", d: "error" };
    const testModel = vi.fn(async (id) => outcomes[id]);
    const disableModels = vi.fn(async () => {});
    const seen = [];
    const result = await testAndDisableFailedModels({
      modelIds: ["a", "b", "c", "d"],
      testModel,
      disableModels,
      delayMs: 0,
      onProgress: (id) => seen.push(id),
    });
    expect(result).toEqual({ testedCount: 4, failedIds: ["b", "d"] });
    expect(disableModels).toHaveBeenCalledTimes(1);
    expect(disableModels).toHaveBeenCalledWith(["b", "d"]);
    expect(seen).toEqual(["a", "b", "c", "d"]);
  });

  it("does not call disable when every model passes", async () => {
    const disableModels = vi.fn();
    const result = await testAndDisableFailedModels({
      modelIds: ["a", "b"],
      testModel: async () => "ok",
      disableModels,
      delayMs: 0,
    });
    expect(result.failedIds).toEqual([]);
    expect(disableModels).not.toHaveBeenCalled();
    expect(bulkDisableMessage(0)).toBe("No error models found.");
    expect(bulkDisableMessage(1)).toBe("Disabled 1 error model.");
    expect(bulkDisableMessage(3)).toBe("Disabled 3 error models.");
  });

  it("tests sequentially with a delay between models, not after the last", async () => {
    const sleep = vi.fn(async () => {});
    await testAndDisableFailedModels({
      modelIds: ["a", "b", "c"],
      testModel: async () => "ok",
      disableModels: async () => {},
      delayMs: 250,
      sleep,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});
