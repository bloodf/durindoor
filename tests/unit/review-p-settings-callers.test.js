import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings caller port", () => {
  it.each([
    "../../src/app/(dashboard)/dashboard/profile/page.js",
    "../../src/app/(dashboard)/dashboard/providers/[id]/ModelAutoSyncPanel.js",
    "../../src/app/(dashboard)/dashboard/headroom/HeadroomClient.js",
    "../../src/app/(dashboard)/dashboard/combos/page.js",
  ])("routes settings requests through the shared store in %s", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/fetch\s*\(\s*["'`]\/api\/settings["'`]/);
    expect(source).toMatch(/(?:requestSettings|useSettingsStore)/);
  });

  it("refreshes endpoint security settings on load", () => {
    const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx", import.meta.url), "utf8");
    expect(source).toContain("fetchSettings({ force: true })");
  });

  it("refreshes combo settings when reloading the list", () => {
    const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/combos/page.js", import.meta.url), "utf8");
    expect(source).toContain("fetchSettings({ force: true })");
  });
});
