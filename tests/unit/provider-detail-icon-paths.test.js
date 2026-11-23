import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url), "utf8");

describe("provider detail icon selection", () => {
  // #1810 prefixes the compatible-node icon with NEXT_PUBLIC_BASE_PATH ("" at root).
  it("keeps custom URLs, compatible fallback icons, and registered logos in separate branches", () => {
    expect(page).toMatch(/providerInfo\.iconUrl\s*\?\s*\(\s*<ProviderIcon\s+src=\{providerInfo\.iconUrl\}[\s\S]*?\/\>\s*\)\s*:\s*isCompatible\s*\?\s*\(\s*<ProviderIcon\s+src=\{`\$\{process\.env\.NEXT_PUBLIC_BASE_PATH \|\| ""\}\/providers\/\$\{providerId\}\.png`\}\s+fallbackSrc=\{[\s\S]*?\/\>\s*\)\s*:\s*\(\s*<ProviderLogo provider=\{providerId\} size=\{48\} \/>/);
  });
});
