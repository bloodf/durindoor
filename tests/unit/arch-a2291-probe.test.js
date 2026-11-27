import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as libraryProbe from "../../src/lib/providerProbe.js";
import * as routeProbe from "../../src/app/api/providers/providerProbe.js";

const readSource = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("shared provider probe architecture", () => {
  it("keeps the health service dependent on the library, not the API layer", () => {
    const health = readSource("src/lib/providerHealthProbe.js");
    const probe = readSource("src/lib/providerProbe.js");
    expect(health).toMatch(/import\(["']@\/lib\/providerProbe\.js["']\)/);
    expect(health).not.toMatch(/@\/app\/api\/providers\/providerProbe/);
    expect(probe).not.toMatch(/(?:@\/app\/|\.\.\/app\/)/);
  });

  it("preserves the route's named exports as the same library functions", () => {
    expect(Object.keys(libraryProbe).sort()).toEqual([
      "buildProviderProbeHeaders",
      "buildRegistryProviderProbe",
      "probeRegistryProvider",
      "validateBedrockSignedProvider",
      "validateChatgptWebSession",
      "validateDevinCloudAgentProvider",
      "validateDifyProvider",
    ]);
    expect(Object.keys(routeProbe).sort()).toEqual(Object.keys(libraryProbe).sort());
    for (const name of Object.keys(libraryProbe)) {
      expect(routeProbe[name]).toBe(libraryProbe[name]);
    }
  });
});
