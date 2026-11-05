import { describe, expect, it } from "vitest";
import path from "node:path";
import { artifactCommands, requiresWebsiteBuild, selectRiskFloor } from "../../scripts/local-ci.mjs";

describe("local workflow parity", () => {
  it("requires a full checkpoint for edits to the owner verification procedure", () => {
    expect(selectRiskFloor(["internal/docs/local-ci.md"], []).mode).toBe("full");
  });
  it("builds the website for shared dashboard, runtime, dependency and build inputs", () => {
    for (const file of ["docs/start.mdx", "website/app/page.js", "src/shared/Card.jsx",
      "open-sse/config/providers.js", "public/logo.svg", "package-lock.json", "package.json",
      ".nvmrc", "next.config.mjs", "postcss.config.mjs", "scripts/build-app.mjs", ".github/workflows/ci.yml"]) {
      expect(requiresWebsiteBuild([file]), file).toBe(true);
    }
    expect(requiresWebsiteBuild(["internal/docs/architecture.mdx", "tests/unit/example.test.js"])).toBe(false);
  });

  it("smokes the exact packed version after build and pack, with no publishing command", () => {
    const src = "/private/snapshot";
    const pack = "/private/pack";
    const commands = artifactCommands(src, pack, "4.11.0-rc.1");
    expect(commands.map(([id]) => id)).toEqual([
      "smoke-standalone", "npm-ci-cli", "build-cli", "pack-cli", "smoke-packed",
    ]);
    expect(commands[0][2].at(-1)).toBe(path.join(src, ".next/standalone/custom-server.js"));
    expect(commands[1][2]).toContain("ci");
    expect(commands[1][3].cwd).toBe(path.join(src, "cli"));
    expect(commands[3][2]).toEqual(["pack", "./cli", "--pack-destination", pack]);
    expect(commands[4][2].at(-1)).toBe(path.join(pack, "durindoor-4.11.0-rc.1.tgz"));
    expect(JSON.stringify(commands)).not.toMatch(/publish|GH_TOKEN|NODE_AUTH_TOKEN/);
  });

  it("rejects package versions that could select a tarball outside the private pack directory", () => {
    for (const version of ["../outside", "4.11.0/../../outside", "*", "", undefined]) {
      expect(() => artifactCommands("/private/src", "/private/pack", version)).toThrow(/version/);
    }
  });
});
