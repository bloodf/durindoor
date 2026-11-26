import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// The runtime stage is everything after the last FROM, with continuations joined.
const runtimeStage = () => read("Dockerfile").split(/^FROM .*$/m).at(-1).replace(/\\\r?\n/g, " ");
const removedPaths = () => runtimeStage().match(/^RUN rm -rf .*$/gm)?.join(" ").split(/\s+/) ?? [];

describe("port-2857: image scan findings (decolua/9router#2857)", () => {
  it("removes the unused Corepack and Yarn installs from the runtime stage", () => {
    expect(removedPaths()).toEqual(expect.arrayContaining([
      "/usr/local/lib/node_modules/corepack",
      "/usr/local/bin/corepack",
      "/usr/local/bin/yarn",
      "/usr/local/bin/yarnpkg",
      "/opt/yarn-v*",
    ]));
  });

  it("keeps npm and npx, which MCP stdio instances run on the gateway host", () => {
    expect(removedPaths().filter((path) => /\/(npm|npx)$/.test(path))).toEqual([]);
    expect(read("docs/features/mcp-gateway.mdx")).toContain("stdio: `npx -y ");
  });

  it("resolves only patched postcss and sharp releases", () => {
    const lock = read("pnpm-lock.yaml");
    const versions = (name) => [...lock.matchAll(new RegExp(`^  ${name}@(\\d+)\\.(\\d+)\\.(\\d+)`, "gm"))]
      .map((match) => match.slice(1).map(Number));
    const atLeast = ([major, minor, patch], [floorMajor, floorMinor, floorPatch]) =>
      major !== floorMajor ? major > floorMajor : minor !== floorMinor ? minor > floorMinor : patch >= floorPatch;

    for (const [name, floor] of [["postcss", [8, 5, 18]], ["sharp", [0, 35, 0]]]) {
      expect(versions(name).length, name).toBeGreaterThan(0);
      expect(versions(name).filter((version) => !atLeast(version, floor)), name).toEqual([]);
    }
  });

  it("uses a GitLab token placeholder that secret scanners do not read as a token", () => {
    const source = read("src/shared/components/GitLabAuthModal.js");

    expect(source).toContain('placeholder="glpat-****************"');
    expect(source).not.toMatch(/glpat-[0-9A-Za-z_-]{20}/);
  });
});
