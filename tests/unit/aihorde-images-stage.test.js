// #2034 staging boundary for AI Horde native images. Every assertion that
// changes when the adapter is registered lives here, so a later registration
// can promote this block alone; the catalog and flow tests stay unchanged.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import aihordeRegistry from "../../open-sse/providers/registry/aihorde.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import manifest from "../../open-sse/executors/staged.json";
import { IMAGE_ADAPTERS, getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";
import stagedAdapter from "../../open-sse/handlers/imageProviders/aihorde.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("AI Horde native images are staged, not registered", () => {
  it("has no image adapter under the canonical id or the alias", () => {
    expect(getImageAdapter("aihorde")).toBeNull();
    expect(getImageAdapter("horde")).toBeNull();
    expect(isImageProvider("aihorde")).toBe(false);
    expect(Object.keys(IMAGE_ADAPTERS)).not.toContain("aihorde");
    expect(read("open-sse/handlers/imageProviders/index.js")).not.toMatch(/aihorde/i);
  });

  it("no production module imports the staged adapter or catalog", () => {
    expect(read("open-sse/handlers/imageGenerationCore.js")).not.toMatch(/aihorde/i);
    expect(read("open-sse/index.js")).not.toMatch(/aihordeImageCatalog|imageProviders\/aihorde/);
  });

  it("the staged adapter exposes only the generate contract and b64_json", () => {
    expect(stagedAdapter).toMatchObject({ async: true, staged: true, responseFormats: ["b64_json"] });
    expect(typeof stagedAdapter.generate).toBe("function");
    expect(stagedAdapter.buildUrl).toBeUndefined();
    expect(stagedAdapter.useExecutor).toBeUndefined();
  });

  it("adds no provider identity, private definition or staging metadata", () => {
    expect(REGISTRY.filter((entry) => entry.id === "aihorde" || entry.alias === "horde")).toHaveLength(1);
    expect(Object.keys(STAGED_PROVIDERS).filter((id) => /horde/i.test(id))).toEqual([]);
    expect(manifest.modules.filter(({ module, provider }) => /horde/i.test(`${module} ${provider}`))).toEqual([]);
  });

  it("keeps the registered chat route on the OpenAI facade with the Bearer sentinel", () => {
    expect(aihordeRegistry.transport).toEqual({
      baseUrl: "https://oai.aihorde.net/v1/chat/completions",
      baseUrls: ["https://oai.aihorde.net/v1/chat/completions"],
      format: "openai",
      noAuth: true,
      headers: { Authorization: "Bearer 0000000000" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    });
    expect(aihordeRegistry.modelsFetcher).toEqual({ url: "https://oai.aihorde.net/v1/models", type: "openai" });
    expect(aihordeRegistry).toMatchObject({ id: "aihorde", alias: "horde", noAuth: true, authType: "apikey", passthroughModels: true });
  });
});
