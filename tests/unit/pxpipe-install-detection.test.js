import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getInstallInfo, libraryEntry } from "../../src/lib/pxpipe/install.js";
import { getPxpipeStatus } from "../../src/lib/pxpipe/service.js";

function readVersionFromPackage(pkgRoot) {
  const pkgPath = path.join(pkgRoot, "package.json");
  return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
}

describe("pxpipe bundled dependency detection", () => {
  it("detects installed pxpipe-proxy and exposes the exported library entry", () => {
    const info = getInstallInfo();
    expect(info.installed).toBe(true);
    expect(typeof info.path).toBe("string");
    expect(info.path).toContain("pxpipe-proxy");
    expect(info.version).toBe(readVersionFromPackage(info.path));

    const entry = libraryEntry();
    expect(entry).toMatch(/pxpipe-proxy.*library\.js$/);

    const status = getPxpipeStatus();
    expect(status.installMethod).toBe("dependency");
    expect(status.dependencyMissing).toBe(false);
  });
});
