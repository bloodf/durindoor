import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const literalsDir = resolve(__dirname, "../../public/i18n/literals");
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const localeFiles = readdirSync(literalsDir).filter((name) => name.endsWith(".json")).sort();
const en = load(resolve(literalsDir, "en.json"));
const englishKeys = Object.keys(en);
const floor = load(resolve(__dirname, "../fixtures/i18n-coverage-floor.json"));
const locales = localeFiles.map((file) => ({
  name: file.slice(0, -5),
  messages: load(resolve(literalsDir, file)),
}));

function readProductionSources() {
  const srcDir = resolve(__dirname, "../../src");
  const pending = [srcDir];
  const sources = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current)) {
      const path = resolve(current, entry);
      if (statSync(path).isDirectory()) {
        pending.push(path);
      } else if (/\.(?:js|jsx|ts|tsx)$/.test(entry) && !/\.stories\./.test(entry)) {
        sources.push(readFileSync(path, "utf8"));
      }
    }
  }
  return sources;
}
const productionSources = readProductionSources();
const productionSourceContains = (key) => productionSources.some((source) =>
  source.includes(JSON.stringify(key)) || source.includes(`'${key}'`)
);

describe("i18n locale coverage and drift", () => {
  it("allows English-missing keys only while production source still uses them", () => {
    for (const { name, messages } of locales) {
      for (const key of Object.keys(messages)) {
        if (!Object.hasOwn(en, key)) {
          expect(productionSourceContains(key), `${name}.json contains stale key: ${key}`).toBe(true);
        }
      }
    }
  });

  it("keeps shipped labels with live source use even when English lacks the key", () => {
    for (const key of ["Cached Cost", "Delete Proxy Pool", "Skills", "Open settings", "No usage recorded yet."]) {
      expect(Object.hasOwn(en, key), `${key} remains absent from English`).toBe(false);
      expect(productionSourceContains(key), `${key} has a production source`).toBe(true);
      expect(Object.hasOwn(load(resolve(literalsDir, "pt-BR.json")), key), `${key} retains its pt-BR translation`).toBe(true);
    }
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
