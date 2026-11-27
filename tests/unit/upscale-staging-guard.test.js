import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isForbiddenUpscaleReference } from "../helpers/upscale-staging-guard.js";

const prefix = "open-sse/services/providerParity/native-syntx-media/";
const registration = readFileSync(new URL(`../../${prefix}registration.json`, import.meta.url), "utf8");

describe("upscale staging guard", () => {
  it("accepts only the current private ownership notes", () => {
    for (const name of ["config.js", "index.js", "registration.json"]) {
      const path = prefix + name;
      expect(isForbiddenUpscaleReference(path, readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"))).toBe(false);
    }
    const { status, owner } = JSON.parse(registration).modalities.upscale;
    expect({ status, owner }).toEqual({ status: "owned-by-native-image-upscale", owner: "native-image-upscale private framework unit" });
  });

  it.each([
    'import x from "native-image-upscale";',
    'export { x } from "native-image-upscale";',
    'import("native-image-upscale");',
    'require("native-image-upscale");',
    'const path = "native-image-upscale";',
    '// native-image-upscale ownership note',
    '{ "owner": "native-image-upscale private framework unit" }',
  ])("rejects references in public source: %s", (source) => {
    expect(isForbiddenUpscaleReference("src/publicregistry/config.json", source)).toBe(true);
  });

  it("rejects runtime references in private files and extra JSON module references", () => {
    expect(isForbiddenUpscaleReference(`${prefix}index.js`, '// native-image-upscale note\nimport "native-image-upscale";')).toBe(true);
    const changed = JSON.parse(registration);
    changed.modalities.upscale.module = "native-image-upscale";
    expect(isForbiddenUpscaleReference(`${prefix}registration.json`, JSON.stringify(changed, null, 2))).toBe(true);
    expect(isForbiddenUpscaleReference(`${prefix}registration.json`, registration.replace('"sourceFlow":', '"module": "activation",\n      "sourceFlow":'))).toBe(true);
    expect(isForbiddenUpscaleReference(`${prefix}registration.json`, registration.replace('owned-by-native-image-upscale', 'native-image-upscale'))).toBe(true);
  });
});
