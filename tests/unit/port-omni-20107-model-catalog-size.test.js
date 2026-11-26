import { describe, expect, it, vi } from "vitest";

const { saveSnapshot } = vi.hoisted(() => ({ saveSnapshot: vi.fn(async () => {}) }));

vi.mock("@/lib/localDb", () => ({
  getCachedSharedModelMetadata: vi.fn(async () => null),
  saveCachedSharedModelMetadata: saveSnapshot,
}));

const { refreshSharedModelMetadata } = await import("../../src/lib/modelAutoSync/sharedMetadata.js");

const catalog = (padding) => JSON.stringify({
  openai: { models: { "gpt-x": { limit: { context: 1000, output: 100 } } } },
  padding,
});

const refresh = (body) => refreshSharedModelMetadata({ force: true, fetchCatalog: async () => new Response(body) });

describe("OmniRoute #20107 - bounded models.dev catalog download", () => {
  it("refuses a catalog above 16 MiB and keeps the previous snapshot", async () => {
    expect(await refresh(catalog("x".repeat(16 * 1024 * 1024)))).toBeNull();
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("still saves a catalog of ordinary size", async () => {
    expect(await refresh(catalog(""))).toMatchObject({ providers: { openai: { "gpt-x": expect.any(Object) } } });
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
  });
});
