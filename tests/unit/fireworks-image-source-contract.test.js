// Source-review regression tests, not evidence that a vendor endpoint works.
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import * as staged from "../../open-sse/services/providerParity/native-fireworks-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import fireworksRegistry from "../../open-sse/providers/registry/fireworks.js";
const manifest = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-fireworks-image/registration.json", import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());
it("blocks batch08 activation without deleting unresolved source rows", () => {
  expect(manifest.activationAllowed).toBe(false);
  expect(manifest.status).toBe("blocked-source-unresolved");
  expect(manifest.acceptance.liveAccountRequired).toBe(false);
  expect(manifest.integrationPoints).toEqual([]);
  expect(manifest.endpoints).toEqual({});
  expect(manifest.provider.addServiceKinds).toEqual([]);
  expect(manifest.models.image).toEqual([]);
  expect(manifest.sourceModels.map(m => m.id)).toEqual(staged.FIREWORKS_IMAGE_MODELS.map(m => m.id));
  expect(manifest.sourceModels).toHaveLength(5);
  expect(staged.FIREWORKS_IMAGE_URL).toBeNull();
  expect(staged.FIREWORKS_SUPPORTED_IMAGE_MODELS).toEqual([]);
  expect(staged.fireworksImageAdapter.models).toEqual([]);
  expect(getImageAdapter("fireworks")).toBeFalsy();
  expect(fireworksRegistry.serviceKinds).toEqual(["llm", "embedding"]);
  expect(fireworksRegistry.imageConfig).toBeUndefined();
  for (const name of Object.keys(manifest.exports)) expect(staged).toHaveProperty(name);
});
it.each(staged.FIREWORKS_IMAGE_MODELS)("refuses $id before credential access, billing or polling", async ({ id }) => {
  const fetch = vi.fn(() => { throw new Error("network forbidden"); });
  vi.stubGlobal("fetch", fetch);
  const credentials = { get apiKey() { throw new Error("must not inspect credentials"); } };
  expect(() => staged.buildFireworksImageRequest(id, { prompt: "synthetic" })).toThrow(/source contract is unresolved/);
  const result = await staged.fireworksImageAdapter.generate({ model: id, body: { prompt: "synthetic" }, credentials });
  expect(result.status).toBe(400);
  expect(result.acceptedJob).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});
it("records primary source URLs, checked date and pinned SDK evidence", () => {
  expect(manifest.checkedDate).toBe("2026-11-27");
  expect(manifest.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
  expect(manifest.primarySources).toHaveLength(5);
  expect(manifest.primarySources.at(-1).url).toContain("e09df11e25c2b0e1548c5d3e5e765111a6438986/src/fireworks/_client.py");
});
