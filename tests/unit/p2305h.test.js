import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCustomModels from "../../src/app/(dashboard)/dashboard/providers/[id]/hooks/useCustomModels.js";
import useProviderAutoSync from "../../src/app/(dashboard)/dashboard/providers/[id]/hooks/useProviderAutoSync.js";

const root = resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard/providers/[id]");

afterEach(() => vi.unstubAllGlobals());

describe("provider detail dashboard requests", () => {
  it("has no raw fetch calls in hooks, sections, or node update", () => {
    const files = ["updateCompatibleProviderNode.js", ...["hooks", "sections"].flatMap((dir) => readdirSync(resolve(root, dir), { recursive: true }).filter((name) => /\.[jt]sx?$/.test(name)).map((name) => `${dir}/${name}`))];
    for (const file of files) expect(readFileSync(resolve(root, file), "utf8"), file).not.toMatch(/\bfetch\s*\(/);
  });

  it("preserves the custom model error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Model rejected" }) }));
    const hook = useCustomModels({ providerStorageAlias: "test" });
    await expect(hook.handleAddCustomModel("model")).rejects.toThrow("Model rejected");
  });

  it("preserves the model sync error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Sync rejected" }) }));
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const hook = useProviderAutoSync({ connections: [{ id: "one" }], providerGenerationRef: { current: 1 }, setSyncingModels: vi.fn() });
    await hook.handleSyncModels();
    expect(alert).toHaveBeenCalledWith("Sync rejected");
  });
});
