import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Migrator } from "../../scripts/migrate-from-9router.mjs";

const tempDirs = [];
function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "backup-perms-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("migration backup permissions", () => {
  it("creates the 9router tar with owner-only permissions", () => {
    const root = makeTempDir();
    const legacyDir = join(root, "9router");
    mkdirSync(legacyDir);
    writeFileSync(join(legacyDir, "config.json"), "secret");
    const m = new Migrator({
      targetDir: join(root, "durindoor"),
      legacyDir,
      dryRun: false,
      backupRoot: join(root, "9router-backup.tar"),
    });

    const backup = m.backup(legacyDir);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
  });

  it("passes PostgreSQL passwords through PGPASSWORD and strips them from psql URLs", () => {
    const script = readFileSync(new URL("../../scripts/copy-proxy-timeline-to-pg.sh", import.meta.url), "utf8");
    expect(script).toMatch(/PGPASSWORD="\$pg_password" docker exec[^\n]*-e PGPASSWORD[^\n]*psql/);
    expect(script).toMatch(/u\.password\s*=\s*""/);
    expect(script).not.toMatch(/psql\s+"\$DURINDOOR_PG_URL"/);
  });
});
