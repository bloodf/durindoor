import { describe, expect, it } from "vitest";
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
  "Request Details": "Chi tiết yêu cầu",
  "Overview": "Tổng quan",
  "No providers connected": "Chưa có nhà cung cấp nào được kết nối",
  "Retry": "Thử lại",
};

describe("Vietnamese dashboard labels", () => {
  it("provides the reviewed translations for canonical English keys", () => {
    for (const [key, translation] of Object.entries(translations)) {
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(vi[key], key).toBe(translation);
    }
  });
});
