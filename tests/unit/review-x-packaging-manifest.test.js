import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const require = createRequire(import.meta.url);

describe("standalone packaging manifest", () => {
  it("is shared by the build and CLI and contains existing, unique paths", () => {
    const manifest = JSON.parse(read("scripts/packaging-manifest.json"));
    expect(manifest.length).toBeGreaterThan(0);
    expect(new Set(manifest.map((entry) => entry.path)).size).toBe(manifest.length);
    for (const entry of manifest) expect(existsSync(new URL(entry.path, root))).toBe(true);
    expect(read("scripts/build-app.mjs")).toContain('require("./packaging-manifest.json")');
    expect(read("cli/scripts/standaloneSidecars.js")).toContain('require("../../scripts/packaging-manifest.json")');
    expect(require("../../cli/scripts/standaloneSidecars.js").STANDALONE_SIDECARS)
      .toEqual(manifest.filter((entry) => entry.sidecar).map((entry) => entry.path));
  });

  it("copies the standalone output without repeating manifest entries", () => {
    const manifest = JSON.parse(read("scripts/packaging-manifest.json"));
    const docker = read("Dockerfile");
    expect(docker).toContain("COPY --from=builder /app/.next/standalone ./");
    for (const entry of manifest) {
      expect(docker).not.toContain(`COPY --from=builder /app/${entry.path} `);
    }
  });
});
