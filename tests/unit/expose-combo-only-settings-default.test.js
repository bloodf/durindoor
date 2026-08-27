import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
  getAdapterSync: vi.fn(),
}));

vi.mock("@/lib/db/driver.js", () => mocks);

const { getSettings } = await import("../../src/lib/db/repos/settingsRepo.js");

describe("exposeComboOnly default", () => {
  it("is false when the persisted row has no value", async () => {
    await expect(getSettings()).resolves.toMatchObject({ exposeComboOnly: false });
  });
});
