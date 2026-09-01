import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const bootstrap = read("public/theme-bootstrap.js");

function runBootstrap({ stored = null, initialDark = false, systemDark = false, storageError = null, mediaError = null } = {}) {
  let dark = initialDark;
  const context = {
    document: {
      documentElement: {
        classList: {
          toggle(name, enabled) {
            expect(name).toBe("dark");
            dark = enabled;
          },
        },
      },
    },
    localStorage: {
      getItem(key) {
        expect(key).toBe("theme");
        if (storageError) throw storageError;
        return stored;
      },
    },
    window: {
      matchMedia(query) {
        if (mediaError) throw mediaError;
        expect(query).toBe("(prefers-color-scheme: dark)");
        return { matches: systemDark };
      },
    },
  };

  expect(() => runInNewContext(bootstrap, context)).not.toThrow();
  return dark;
}

const persisted = (theme) => JSON.stringify({ state: { theme }, version: 0 });

describe("pre-paint theme bootstrap", () => {
  it("applies persisted dark and light themes", () => {
    expect(runBootstrap({ stored: persisted("dark") })).toBe(true);
    expect(runBootstrap({ stored: persisted("light"), initialDark: true })).toBe(false);
  });

  it("resolves persisted system theme from the current color scheme", () => {
    expect(runBootstrap({ stored: persisted("system"), systemDark: true })).toBe(true);
    expect(runBootstrap({ stored: persisted("system"), initialDark: true, systemDark: false })).toBe(false);
  });

  it.each([
    ["missing storage", null],
    ["malformed JSON", "{"],
    ["missing persisted state", "{}"],
    ["unknown theme", persisted("sepia")],
  ])("leaves the root class unchanged for %s", (_name, stored) => {
    expect(runBootstrap({ stored, initialDark: true })).toBe(true);
  });

  it("does not throw or change the root class when storage is inaccessible", () => {
    expect(runBootstrap({ initialDark: true, storageError: new Error("denied") })).toBe(true);
  });

  it("does not throw or change the root class when system preference is inaccessible", () => {
    expect(runBootstrap({ stored: persisted("system"), initialDark: true, mediaError: new Error("denied") })).toBe(true);
  });

  it("loads before hydration from a same-origin file without weakening CSP", () => {
    const layout = read("src/app/layout.js");
    const nextConfig = read("next.config.mjs");
    const bootstrapIndex = layout.indexOf('<script src="/theme-bootstrap.js"></script>');
    const fontBootstrapIndex = layout.indexOf("dangerouslySetInnerHTML");

    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeLessThan(fontBootstrapIndex);
    expect(nextConfig).not.toContain("'unsafe-inline'");
  });
});
