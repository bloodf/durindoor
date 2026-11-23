import { describe, expect, it, vi } from "vitest";
import { importCompatibleModels } from "../../src/shared/utils/compatibleModelImport.js";

describe("compatible model imports", () => {
  it("continues after rejected and unsuccessful saves and counts duplicates", async () => {
    const add = vi.fn(async (id) => {
      if (id === "rejected") throw new Error("save failed");
      if (id === "unsuccessful") return false;
    });
    const result = await importCompatibleModels(
      [{ id: "existing" }, { id: "rejected" }, { id: "rejected" }, { name: "saved" }, { model: "unsuccessful" }, {}],
      [{ id: "existing" }],
      add,
    );
    expect(result).toEqual({ imported: 1, failed: 2, skipped: 3 });
    expect(add.mock.calls).toEqual([["rejected"], ["saved"], ["unsuccessful"]]);
  });

  it("retries failed models in a subsequent import", async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    expect(await importCompatibleModels([{ id: "retry" }], [], add)).toEqual({ imported: 0, failed: 1, skipped: 0 });
    expect(await importCompatibleModels([{ id: "retry" }], [], add)).toEqual({ imported: 1, failed: 0, skipped: 0 });
  });
});
