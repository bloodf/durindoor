import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve("../src/app/(dashboard)/dashboard/providers/[id]/page.js");
const indexPath = path.resolve("../src/shared/components/index.js");
const modalPath = path.resolve("../src/shared/components/ImportTokenModal.js");

describe("ProviderDetailPage import-token branch", () => {
  it("branches to ImportTokenModal when providerInfo.flowType is import_token", () => {
    const page = fs.readFileSync(pagePath, "utf8");
    expect(page).toContain("ImportTokenModal");
    expect(page).toContain("providerInfo?.flowType === \"import_token\"");
    expect(page).toContain("isImportToken ? (");
  });

  it("exports ImportTokenModal from shared components index", () => {
    const index = fs.readFileSync(indexPath, "utf8");
    expect(index).toContain('ImportTokenModal');
  });

  it("renders a generic import token modal for any provider", () => {
    const modal = fs.readFileSync(modalPath, "utf8");
    expect(modal).toContain("/api/oauth/${provider}/import-token");
    expect(modal).toContain("accessToken");
  });
});
