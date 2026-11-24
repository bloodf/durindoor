import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(`../${file}`), "utf8");

describe("dashboard review regressions (#2283)", () => {
  const combos = read("src/app/(dashboard)/dashboard/combos/page.js");
  const providers = read("src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js");
  const providerDetail = read("src/app/(dashboard)/dashboard/providers/[id]/sections/ProviderDetailSections.jsx");
  const keys = read("src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx");
  const update = read("src/shared/components/UpdatePanel.js");

  it("does not persist combo strategy state after a rejected response", () => {
    expect(combos).toMatch(/if\s*\(!res\.ok\)[\s\S]*?throw new Error[\s\S]*?setComboStrategies\(updated\)/);
    expect(combos).toMatch(/Error updating combo strategy:[\s\S]*?alert\(error\.message/);
  });

  it("labels provider form fields and preserves priority draft values", () => {
    for (const id of ["connection-name", "connection-credential", "connection-search-engine-id", "connection-priority"]) {
      expect(providers).toContain(`id="${id}"`);
      expect(providers).toContain(`htmlFor="${id}"`);
    }
    expect(providers).toMatch(/priority: e\.target\.value === "" \? "" : Number\.parseInt/);
    expect(providers).toMatch(/onBlur=\{\(\) => setFormData\([\s\S]*?priority: Number\.isInteger/);
  });

  it("labels token import and inline model editing controls", () => {
    expect(providerDetail).toMatch(/<textarea\s+aria-label="Import provider token"/);
    expect(combos).toMatch(/<input\s+aria-label=\{`Model \$\{index \+ 1\}`\}/);
  });

  it("checks response status before parsing dashboard loaders", () => {
    expect(combos).toMatch(/const combosData = combosRes\.ok \? await combosRes\.json\(\) : await combosRes\.json\(\)\.catch/);
    expect(combos).toMatch(/const providersData = providersRes\.ok \? await providersRes\.json\(\) : await providersRes\.json\(\)\.catch/);
    expect(keys).toMatch(/const keysData = keysRes\.ok \? await keysRes\.json\(\) : await keysRes\.json\(\)\.catch/);
    expect(keys).toMatch(/const data = response\.ok \? await response\.json\(\) : await response\.json\(\)\.catch/);
    expect(keys).toMatch(/const data = res\.ok \? await res\.json\(\) : await res\.json\(\)\.catch/);
  });

  it("clears the old shutdown timer and starts the disabled countdown before clipboard access", () => {
    expect(update).toMatch(/const handleCopyAndShutdown = async \(\) => \{\s*if \(countdownRef\.current\) clearInterval\(countdownRef\.current\);\s*countdownRef\.current = null;\s*setCountdown\(UPDATER_CONFIG\.shutdownCountdownSec\);\s*try \{\s*await navigator\.clipboard\.writeText/);
  });
});
