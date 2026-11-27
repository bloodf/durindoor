import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const files = [
  "rtk.e2e.test.js",
  "rtk.multi-provider.e2e.test.js",
  "db-concurrent.test.js",
  "chatgpt-web-browser-session.test.js",
];

// The browser test's timeoutMarker is a failure deadline, not a synchronization sleep.
function forbiddenWaits(source) {
  return [...source.matchAll(/(?:setTimeout\s*\([^;]*?,\s*|sleep\s*\(\s*)(\d[\d_]*)\s*\)/g)]
    .filter((match) => Number(match[1].replaceAll("_", "")) >= 100 && !match[0].includes("resolve(timeoutMarker)"));
}

describe("c2300 synchronization", () => {
  it("detects long sleeps", () => {
    expect(forbiddenWaits("setTimeout(resolve, 100); sleep(200)")).toHaveLength(2);
    expect(forbiddenWaits("setTimeout(resolve, 50)")).toHaveLength(0);
    expect(forbiddenWaits("setTimeout(\n  resolve,\n  1000\n)")).toHaveLength(1);
  });
  for (const file of files) {
    it(`${file} avoids fixed synchronization sleeps and port`, () => {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(forbiddenWaits(source)).toHaveLength(0);
      expect(source).not.toMatch(/\b20128\b/);
    });
  }
});
