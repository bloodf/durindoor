import { afterEach, describe, expect, it, vi } from "vitest";
import { runStartupTasks } from "../../src/lib/startup/startupTasks.js";

describe("startup task runner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs every task independently and labels a failed task at warn level", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = [];

    runStartupTasks([
      { name: "first", loader: async () => "one", run: (value) => started.push(value) },
      { name: "broken", loader: async () => { throw new Error("database unavailable"); }, run: () => {} },
      { name: "last", loader: async () => "three", run: (value) => started.push(value) },
    ]);

    await vi.waitFor(() => {
      expect(started).toEqual(["one", "three"]);
      expect(warn).toHaveBeenCalledWith("[startup] broken failed: database unavailable");
    });
  });
});
