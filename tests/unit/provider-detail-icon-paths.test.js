import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url), "utf8");

describe("provider detail icon selection", () => {
  it("keeps custom URLs, compatible fallback icons, and registered logos in separate branches", () => {
    expect(page).toMatch(/providerInfo\.iconUrl\s*\?\s*\(\s*<ProviderIcon\s+src=\{providerInfo\.iconUrl\}[\s\S]*?\/\>\s*\)\s*:\s*isCompatible\s*\?\s*\(\s*<ProviderIcon\s+src=\{`\/providers\/\$\{providerId\}\.png`\}\s+fallbackSrc=\{[\s\S]*?\/\>\s*\)\s*:\s*\(\s*<ProviderLogo provider=\{providerId\} size=\{48\} \/>/);
  });
});
