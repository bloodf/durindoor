// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi as mock } from "vitest";
import { reloadTranslations, translate } from "../../src/i18n/runtime.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const literalsDir = resolve(__dirname, "../../public/i18n/literals");
const load = (name) => JSON.parse(readFileSync(resolve(literalsDir, name), "utf8"));
const en = load("en.json");
const vi = load("vi.json");

const translations = {
  "API Keys": "Khóa API",
  "Docs": "Tài liệu",
  "Logs": "Nhật ký",
  "Translator": "Trình dịch",
  // Both spellings are intentional: the drawer uses lowercase d, and other callers may use uppercase D.
  "Request Details": "Chi tiết yêu cầu",
  "Request details": "Chi tiết yêu cầu",
  "Overview": "Tổng quan",
  "No providers connected": "Chưa có nhà cung cấp nào được kết nối",
  "Retry": "Thử lại",
};

describe("Vietnamese dashboard labels", () => {
  afterEach(() => {
    mock.unstubAllGlobals();
    document.cookie = "locale=; max-age=0; path=/";
  });

  it("translates the shipped drawer title and falls back for missing labels", async () => {
    const source = readFileSync(resolve(__dirname, "../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js"), "utf8");
    const drawerTitle = source.match(/title="(Request details)"/)?.[1];
    expect(drawerTitle).toBe("Request details");
    document.cookie = "locale=vi; path=/";
    mock.stubGlobal("fetch", mock.fn().mockResolvedValue({ ok: true, json: async () => vi }));
    await reloadTranslations();
    expect(translate(drawerTitle)).toBe("Chi tiết yêu cầu");
    expect(translate("Request Details")).toBe("Chi tiết yêu cầu");
    expect(translate("Untranslated label")).toBe("Untranslated label");
    mock.stubGlobal("fetch", mock.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await reloadTranslations();
    expect(translate(drawerTitle)).toBe(drawerTitle);
    expect(translate("Request Details")).toBe("Request Details");
  });

  it("provides the reviewed translations for canonical English keys", () => {
    for (const [key, translation] of Object.entries(translations)) {
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(vi[key], key).toBe(translation);
    }
  });
});
