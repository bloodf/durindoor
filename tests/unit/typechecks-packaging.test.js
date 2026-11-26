import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/**
 * Deploy regression guard for the #551 boot crash: custom-server.js requires
 * `./src/shared/utils/typeChecks.cjs` at import time, but the entry is added
 * after `next build`, outside Next's NFT trace. Every runtime packaging path
 * (standalone build script and Docker image) must ship the helper explicitly
 * or the deployed server crash-loops with MODULE_NOT_FOUND.
 *
 * Same defense pattern as normalize-env-6828.test.js "runtime packaging
 * ships the helper".
 */
describe("runtime packaging ships typeChecks.cjs (custom-server boot dependency)", () => {
  it("custom-server.js still requires the CJS helper this guard defends", () => {
    const serverSrc = readFileSync(path.join(ROOT, "custom-server.js"), "utf8");
    expect(serverSrc).toContain('require("./src/shared/utils/typeChecks.cjs")');
  });

  it("ships typeChecks.cjs through the standalone manifest", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "scripts", "packaging-manifest.json"), "utf8"));
    expect(manifest.map((entry) => entry.path)).toContain("src/shared/utils/typeChecks.cjs");
    const dockerSrc = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerSrc).toContain("COPY --from=builder /app/.next/standalone ./");
  });
});
