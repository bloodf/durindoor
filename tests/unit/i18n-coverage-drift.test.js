import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const literalsDir = resolve(__dirname, "../../public/i18n/literals");
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const localeFiles = readdirSync(literalsDir).filter((name) => name.endsWith(".json")).sort();
const en = load(resolve(literalsDir, "en.json"));
const englishKeys = Object.keys(en);
const floor = load(resolve(__dirname, "../fixtures/i18n-coverage-floor.json"));
const englishMissingKeys = load(resolve(__dirname, "../fixtures/i18n-english-missing-keys.json"));
const locales = localeFiles.map((file) => ({
  name: file.slice(0, -5),
  messages: load(resolve(literalsDir, file)),
}));

describe("i18n locale coverage and drift", () => {
  it("matches the frozen inventory of locale keys missing from English", () => {
    const actual = Object.fromEntries(locales
      .map(({ name, messages }) => [name, Object.keys(messages).filter((key) => !Object.hasOwn(en, key)).sort()])
      .filter(([, keys]) => keys.length));
    expect(actual).toEqual(englishMissingKeys);
  });

  it("meets the recorded per-locale coverage floors", () => {
    const rows = locales.map(({ name, messages }) => {
      const count = Object.keys(messages).length;
      const percent = ((count / englishKeys.length) * 100).toFixed(1);
      console.log(`${name.padEnd(6)} ${String(count).padStart(4)} / ${englishKeys.length} keys (${percent}%)`);
      expect(Object.hasOwn(floor, name), `missing coverage floor for ${name}`).toBe(true);
      expect(count, `${name}.json coverage dropped below its floor`).toBeGreaterThanOrEqual(floor[name]);
      return name;
    });

    expect(Object.keys(floor).sort(), "coverage floors must match available locales").toEqual(rows.sort());
  });
});
