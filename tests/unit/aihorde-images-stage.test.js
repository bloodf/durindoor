// AI Horde native images: the former staging boundary, promoted to strict
// registration assertions. The catalog and flow tests stay unchanged.
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

describe("AI Horde native images are registered on the existing provider", () => {
  it("registers the image adapter under the canonical id and the alias", () => {
    expect(getImageAdapter("aihorde")).toBe(stagedAdapter);
    expect(getImageAdapter("horde")).toBe(stagedAdapter);
    expect(isImageProvider("aihorde")).toBe(true);
    expect(Object.keys(IMAGE_ADAPTERS)).toContain("aihorde");
    expect(read("open-sse/handlers/imageProviders/index.js")).toMatch(/import aihorde from "\.\/aihorde\.js";/);
  });

  it("dispatches through the shared generate core and lists through the shared catalog owner", () => {
    expect(read("open-sse/handlers/imageGenerationCore.js")).not.toMatch(/aihorde/i);
    expect(read("open-sse/index.js")).not.toMatch(/aihordeImageCatalog|imageProviders\/aihorde/);
    expect(read("src/shared/models/modelCatalogSources.js")).toMatch(/listHordeImageModelRows/);
  });

  it("the registered adapter exposes only the generate contract and b64_json", () => {
    expect(stagedAdapter).toMatchObject({ async: true, defaultResponseFormat: "b64_json", responseFormats: ["b64_json"] });
    expect(stagedAdapter.staged).toBeUndefined();
    expect(typeof stagedAdapter.generate).toBe("function");
    expect(stagedAdapter.buildUrl).toBeUndefined();
    expect(stagedAdapter.useExecutor).toBeUndefined();
  });

  it("adds no provider identity, private definition or staging metadata", () => {
    expect(REGISTRY.filter((entry) => entry.id === "aihorde" || entry.alias === "horde")).toHaveLength(1);
    expect(Object.keys(STAGED_PROVIDERS).filter((id) => /horde/i.test(id))).toEqual([]);
    expect(manifest.modules.filter(({ module, provider }) => /horde/i.test(`${module} ${provider}`))).toEqual([]);
    expect(aihordeRegistry.serviceKinds).toEqual(["llm", "image"]);
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
