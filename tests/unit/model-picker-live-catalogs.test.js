// Upstream 9router #5671: the CLI-tool pickers only asked for the live
// catalogs of cursor/cline/clinepass/zed, while /api/providers/[id]/models
// also serves claude and commandcode. Every CommandCode model was therefore
// unreachable from the model picker, even though the provider page listed it.
//
// In this fork the CLI-tool cards read the server catalog (/api/v1/models),
// which already applies live catalogs; the model picker (ModelSelectModal)
// did not ask for them at all. The picker now fetches the per-account live
// catalog of every provider in LIVE_CATALOG_PROVIDERS and offers those models
// next to the static registry.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LIVE_CATALOG_PROVIDERS } from "@/shared/constants/providers.js";
import { mergeLiveCatalogs, liveCatalogModelEntries } from "@/shared/utils/liveCatalogModels.js";

const MODAL_PATH = path.resolve(
  import.meta.dirname,
  "../../src/shared/components/ModelSelectModal.js"
);

describe("live per-account catalogs in the model picker", () => {
  it("asks for claude and commandcode as well", () => {
    expect(LIVE_CATALOG_PROVIDERS).toEqual(
      expect.arrayContaining(["claude", "commandcode"])
    );
  });

  it("collapses the catalogs of several connections by model id", () => {
    const merged = mergeLiveCatalogs([
      [{ id: "model-a", name: "Model A" }, { id: "model-b" }],
      [{ id: "model-a", name: "Model A (other account)" }, { id: "model-c" }],
    ]);

    expect(merged.map((m) => m.id)).toEqual(["model-a", "model-b", "model-c"]);
    // The first catalog wins for a model both accounts expose.
    expect(merged[0].name).toBe("Model A");
  });

  it("keeps a passthrough catalog that has no static registry entry", () => {
    const entries = liveCatalogModelEntries("cmc", [
      { id: "deepseek/deepseek-v4.1-flash-fast", name: "DeepSeek V4.1 Flash Fast" },
      { name: "no id" },
    ]);

    expect(entries).toEqual([
      {
        id: "deepseek/deepseek-v4.1-flash-fast",
        name: "DeepSeek V4.1 Flash Fast",
        value: "cmc/deepseek/deepseek-v4.1-flash-fast",
        kind: null,
      },
    ]);
  });

  it("the picker fetches the live catalogs and merges them into the group", () => {
    const src = fs.readFileSync(MODAL_PATH, "utf8");

    // The provider list is the shared one, not a second copy in the component.
    expect(src).toContain("LIVE_CATALOG_PROVIDERS");
    expect(src).not.toMatch(/const LIVE_CATALOG_PROVIDERS\s*=\s*\[/);

    // The live catalog is fetched per account and offered next to the static
    // registry entries.
    expect(src).toContain("fetchLiveCatalogModels");
    expect(src).toContain("liveCatalogModelEntries");
  });
});
