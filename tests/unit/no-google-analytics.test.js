import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Privacy invariant: DurinDoor ships with NO external analytics/tracking beacon.
// Google Analytics (@next/third-parties GoogleAnalytics, gaId G-LC959F603F) was
// removed entirely — not merely made opt-in. This guards against reintroduction.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

describe("no external analytics / tracking", () => {
  it("root layout has no Google Analytics component or import", () => {
    const layout = read("src/app/layout.js");
    expect(layout).not.toMatch(/GoogleAnalytics/);
    expect(layout).not.toMatch(/@next\/third-parties/);
    expect(layout).not.toMatch(/G-[A-Z0-9]{8,}/);
    expect(layout).not.toMatch(/googletagmanager|gtag/i);
  });

  it("no @next/third-parties dependency remains in the manifest", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["@next/third-parties"]).toBeUndefined();
  });
});
