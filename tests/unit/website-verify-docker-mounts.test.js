import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("website Docker verification mounts", () => {
  const script = readFileSync(new URL("../../website/scripts/verify-docker.sh", import.meta.url), "utf8");

  it("keeps container writes out of the container layer and removes run data", () => {
    expect(script).toContain("docker run --rm");
    expect(script).toContain("--read-only");
    expect(script).toContain("--tmpfs /tmp");
    expect(script).toMatch(/-e HOME=\/home\/run -v [^\n]*\/home\/run/);
    expect(script).toContain("DURINDOOR_RUN_ROOT");
    expect(script).toMatch(/trap cleanup EXIT[\s\S]*?rm -rf \"\$run_root\"/);
  });
});
