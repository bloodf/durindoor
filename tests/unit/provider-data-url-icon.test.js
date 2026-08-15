import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MAX_PROVIDER_ICON_DATA_BYTES, isValidProviderIconUrl } from "../../src/shared/utils/providerIcon.js";
const png = "data:image/png;base64,iVBORw0KGgo=";

describe("compatible provider data URL icons", () => {
  it("accepts bounded raster image data URLs", () => {
    expect(isValidProviderIconUrl(png)).toBe(true);
    expect(isValidProviderIconUrl("https://icons.example/logo.png")).toBe(true);
  });

  it("rejects unsafe schemes, non-strings, non-images, malformed base64, and SVG", () => {
    for (const iconUrl of [
      null,
      42,
      {},
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://icons.example/" + "x".repeat(2001),
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/png,not-base64",
      "data:image/png;base64,%%%",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    ]) expect(isValidProviderIconUrl(iconUrl)).toBe(false);
  });

  it("rejects encoded and decoded payloads beyond the icon bound", () => {
    const bytes = Buffer.alloc(MAX_PROVIDER_ICON_DATA_BYTES + 1).toString("base64");
    expect(isValidProviderIconUrl(`data:image/png;base64,${bytes}`)).toBe(false);
    expect(isValidProviderIconUrl(`data:image/png;base64,${"A".repeat(MAX_PROVIDER_ICON_DATA_BYTES * 2)}`)).toBe(false);
  });
});

// Regression contract: an invalid/oversize icon URL rejected by the route
// (400 + {error}) must not be silently swallowed by the Add/Edit compatible-
// provider modals. Both call sites must surface res.error via a `saveError`
// state rendered with role="alert" (no DOM test stack installed, so this
// asserts the exact wiring as a source contract).
describe("compatible provider modal surfaces save errors (icon URL rejection included)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const addModal = fs.readFileSync(
    path.join(root, "src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.js"),
    "utf8"
  );
  const editModal = fs.readFileSync(
    path.join(root, "src/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js"),
    "utf8"
  );
  const editPage = fs.readFileSync(
    path.join(root, "src/app/(dashboard)/dashboard/providers/[id]/page.js"),
    "utf8"
  );

  it("AddCompatibleModal sets saveError from the non-ok response and renders role=\"alert\"", () => {
    expect(addModal).toMatch(/setSaveError\(data\.error \|\|/);
    expect(addModal).toMatch(/role="alert"/);
  });

  it("EditCompatibleNodeModal catches onSave rejection into saveError and renders role=\"alert\"", () => {
    expect(editModal).toMatch(/catch \(err\)[\s\S]{0,40}setSaveError\(/);
    expect(editModal).toMatch(/role="alert"/);
  });

  it("page.js handleUpdateNode throws on a non-ok PUT so EditCompatibleNodeModal can catch it", () => {
    expect(editPage).toMatch(/throw new Error\(data\.error \|\| "Failed to update provider node"\)/);
  });
});

describe("provider node API icon validation", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const createRoute = fs.readFileSync(path.join(root, "src/app/api/provider-nodes/route.js"), "utf8");
  const updateRoute = fs.readFileSync(path.join(root, "src/app/api/provider-nodes/[id]/route.js"), "utf8");

  it("rejects a supplied invalid icon URL before POST or PUT persistence", () => {
    for (const route of [createRoute, updateRoute]) {
      expect(route).toMatch(/iconUrl !== undefined && !isValidProviderIconUrl\(iconUrl\)/);
      expect(route).toMatch(/error: "Invalid icon URL"/);
    }
  });
});
