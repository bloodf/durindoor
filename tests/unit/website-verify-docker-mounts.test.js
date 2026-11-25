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
    expect(script).toContain("trap cleanup EXIT");
    expect(script).toMatch(/rm -rf \"\$run_root\"/);
  });
  it("reuses the lockfile base and prunes only old labeled images", () => {
    expect(script).toContain("sha256sum website/pnpm-lock.yaml website/Dockerfile.verify | sha256sum | cut -c1-16");
    expect(script).toContain('image="durindoor-website-base:$lock_hash"');
    expect(script).toContain('docker image inspect "$image"');
    expect(script).toContain("--label durindoor.base=website");
    expect(script).toContain("docker image ls --filter label=durindoor.base=website");
    expect(script).toContain("7 days ago");
    expect(script).toContain('[ "$old_image" = "$image" ] && continue');
    expect(script).toContain('[ "$created_epoch" -lt "$cutoff" ]');
  });

  it("builds from a read-only checkout without installing in the run container", () => {
    const command = script.slice(script.indexOf("docker run --rm"), script.indexOf("printf 'Website verification passed"));
    expect(command).toContain('$(pwd):/repo:ro');
    expect(command).toContain('$run_root/website:/repo/website');
    expect(command).toContain("pnpm run build");
    expect(command).not.toMatch(/(?:pnpm|npm)\s+(?:[^\n]*\s)?install\b/);
  });
});
