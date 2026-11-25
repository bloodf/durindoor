// Port of decolua/9router #4582: closing the add-key modal must discard its form state
// (typed key, bulk text, validation result), so each open starts clean.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/sections/ProviderDetailSections.jsx", import.meta.url), "utf8");

describe("provider page AddApiKeyModal lifecycle", () => {
  it("remounts AddApiKeyModal on each open/close via a key tied to showAddApiKeyModal", () => {
    const tag = page.match(/<AddApiKeyModal\b[^>]*?isOpen=\{showAddApiKeyModal\}/s)?.[0];
    expect(tag, "AddApiKeyModal element with isOpen={showAddApiKeyModal}").toBeTruthy();
    expect(tag).toMatch(/key=\{showAddApiKeyModal\s*\?/);
  });

  it("ConnectionsCard remounts its add-key modal the same way", () => {
    const card = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js", import.meta.url), "utf8");
    const tag = card.match(/<HostAwareAddApiKeyModal\b[^>]*?isOpen=\{showAddModal\}/s)?.[0];
    expect(tag).toBeTruthy();
    expect(tag).toMatch(/key=\{showAddModal\s*\?/);
  });
});
