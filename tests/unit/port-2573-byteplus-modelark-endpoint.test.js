import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import byteplus from "../../open-sse/providers/registry/byteplus.js";

// Port of decolua/9router#2573: BytePlus ModelArk free-tier endpoint moved
// from `/api/coding/v3` to `/api/v3`.
describe("byteplus provider registry (port upstream #2573)", () => {
  it("targets the BytePlus ModelArk free-tier /api/v3 endpoint", () => {
    expect(byteplus.transport.baseUrl).toBe(
      "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
    );
  });
});

// Regression for the Codex P2 on the port PR: the dashboard model-discovery
// configs must use the same /api/v3 service as chat, or model refresh fails
// for the standard/free-tier keys this port enables.
const modelsConfigSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/app/api/providers/[id]/models/modelsConfig.js",
      import.meta.url,
    ),
  ),
  "utf8",
);
const providerModelsConfigSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/app/api/providers/[id]/models/providerModelsConfig.js",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("byteplus dashboard model discovery (port upstream #2573)", () => {
  for (const [name, src] of [
    ["modelsConfig.js", modelsConfigSrc],
    ["providerModelsConfig.js", providerModelsConfigSrc],
  ]) {
    it(`${name} points byteplus at /api/v3/models, not the Coding Plan service`, () => {
      expect(src).toContain(
        'byteplus: createOpenAIModelsConfig("https://ark.ap-southeast.bytepluses.com/api/v3/models")',
      );
      expect(src).not.toContain(
        'byteplus: createOpenAIModelsConfig("https://ark.ap-southeast.bytepluses.com/api/coding/v3/models")',
      );
    });
  }
});
