import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

describe("runtime packaging ships the ESM type checks helper", () => {
  it("runtimeConfig.js still imports the helper this guard defends", () => {
    const runtimeConfigSrc = readFileSync(
      path.join(ROOT, "open-sse", "config", "runtimeConfig.js"),
      "utf8",
    );
    expect(runtimeConfigSrc).toContain(
      'from "../../src/shared/utils/typeChecks.js"',
    );
  });

  it("ships typeChecks.js through the standalone manifest", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "scripts", "packaging-manifest.json"), "utf8"));
    expect(manifest.map((entry) => entry.path)).toContain("src/shared/utils/typeChecks.js");
    const dockerSrc = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerSrc).toContain("COPY --from=builder /app/.next/standalone ./");
  });
});
