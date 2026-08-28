import fs from "node:fs";
import { describe, expect, it } from "vitest";

const pagePath = new URL("../../src/app/(dashboard)/dashboard/profile/page.js", import.meta.url);

describe("profile exposeComboOnly toggle contract", () => {
  it("PATCHes the authenticated settings route and renders persisted state", () => {
    const source = fs.readFileSync(pagePath, "utf8");

    expect(source).toContain("const updateExposeComboOnly = async (exposeComboOnly) =>");
    expect(source).toContain('body: JSON.stringify({ exposeComboOnly })');
    expect(source).toContain("exposeComboOnly: data.exposeComboOnly === true");
    expect(source).toContain("checked={settings.exposeComboOnly === true}");
  });
});
