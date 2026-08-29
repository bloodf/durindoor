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

  it("build-app.mjs copies typeChecks.js into the standalone bundle", () => {
    const buildSrc = readFileSync(path.join(ROOT, "scripts", "build-app.mjs"), "utf8");
    expect(buildSrc).toContain(
      'path.join(process.cwd(), "src", "shared", "utils", "typeChecks.js")',
    );
    expect(buildSrc).toContain(
      'path.join(standaloneDir, "src", "shared", "utils", "typeChecks.js")',
    );
  });

  it("Dockerfile copies typeChecks.js beside the existing runtime helpers", () => {
    const dockerSrc = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerSrc).toContain(
      "COPY --from=builder /app/src/shared/utils/typeChecks.js ./src/shared/utils/typeChecks.js",
    );
  });
});
