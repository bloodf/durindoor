import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Key-parity guard for port(upstream): #2436.
// `en.json` is the committed canonical identity map (key === English source
// string); `zh-CN.json` carries the Chinese translations for the same keys.
// The two MUST expose identical key sets so every English UI literal has a
// zh-CN entry and zh-CN never drifts ahead of the catalog.
// NOTE: the catalog is flat — keys are the literal UI strings and may contain
// periods, so we never split/join on "." here.
const __dirname = dirname(fileURLToPath(import.meta.url));
const LITERALS = resolve(__dirname, "../../public/i18n/literals");

function load(name) {
  return JSON.parse(readFileSync(resolve(LITERALS, name), "utf8"));
}

const en = load("en.json");
const zh = load("zh-CN.json");
const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();

describe("i18n zh-CN key parity (upstream #2436)", () => {
  it("en.json is a non-empty identity catalog", () => {
    expect(enKeys.length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(en)) {
      expect(v).toBe(k);
    }
  });

  it("zh-CN key set equals en key set", () => {
    const enSet = new Set(enKeys);
    const zhSet = new Set(zhKeys);
    const missingInZh = enKeys.filter((k) => !zhSet.has(k));
    const extraInZh = zhKeys.filter((k) => !enSet.has(k));
    expect({ missingInZh, extraInZh }).toEqual({ missingInZh: [], extraInZh: [] });
  });

  it("every zh-CN value is a non-empty string", () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(typeof v, `key: ${k}`).toBe("string");
      expect(v.length, `key: ${k}`).toBeGreaterThan(0);
    }
  });
});
