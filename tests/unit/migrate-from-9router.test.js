import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rewriteProviderLabels, Migrator } from "../../scripts/migrate-from-9router.mjs";

function makeTempDir(prefix = "migrate-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("rewriteProviderLabels", () => {
  it("renames known TOML provider sections and leaves unrelated tables alone", () => {
    const input = `[providers.9router]\nbaseUrl = "http://localhost"\n[model_providers.9router]\n[provider.9router]\n[profiles.9router]\nname = "keep"\n`;
    const out = rewriteProviderLabels(input, "toml");
    expect(out).toContain("[providers.durindoor]");
    expect(out).toContain("[model_providers.durindoor]");
    expect(out).toContain("[provider.durindoor]");
    expect(out).toContain("[profiles.9router]");
    expect(out).not.toContain("[profiles.durindoor]");
  });

  it("renames TOML model_provider assignment", () => {
    const input = `model_provider = "9router"\nother = "9router"\n`;
    const out = rewriteProviderLabels(input, "toml");
    expect(out).toContain('model_provider = "durindoor"');
    expect(out).toContain('other = "9router"');
  });

  it("does not rewrite TOML section-looking text inside string values", () => {
    const input = `note = "see [providers.9router] docs"\n`;
    const out = rewriteProviderLabels(input, "toml");
    expect(out).toBe(input);
  });

  it("renames JSON provider keys only inside known containers", () => {
    const input = JSON.stringify({
      providers: { "9router": { baseUrl: "x" }, openai: {} },
      notes: { "9router": "keep me" },
    }, null, 2);
    const out = rewriteProviderLabels(input, "json");
    const obj = JSON.parse(out);
    expect(obj.providers.durindoor).toEqual({ baseUrl: "x" });
    expect(obj.providers["9router"]).toBeUndefined();
    expect(obj.notes["9router"]).toBe("keep me");
  });

  it("keeps JSON5 comments and renames inside provider containers", () => {
    const input = `{
      // provider map
      "providers": {
        "9router": { "model": "gpt-4" }
      },
      /* ignored */
      "notes": { "9router": "keep" }
    }`;
    const out = rewriteProviderLabels(input, "json5");
    expect(out).toContain('"durindoor": { "model": "gpt-4" }');
    expect(out).toContain('"9router": "keep"');
  });

  it("keeps provider-prefixed model ids in sync inside the same provider object", () => {
    const input = JSON.stringify({
      providers: {
        "9router": {
          models: [
            { id: "9router/gpt-4" },
            { id: "9router/gpt-3.5" },
          ],
        },
      },
    }, null, 2);
    const out = rewriteProviderLabels(input, "json");
    const obj = JSON.parse(out);
    expect(obj.providers.durindoor.models[0].id).toBe("durindoor/gpt-4");
    expect(obj.providers.durindoor.models[1].id).toBe("durindoor/gpt-3.5");
  });

  it("rewrites a sibling model id even when it appears before the provider map", () => {
    const input = JSON.stringify({ model: "9router/foo", provider: { "9router": {} } }, null, 2);
    const out = rewriteProviderLabels(input, "json");
    const obj = JSON.parse(out);
    expect(obj.model).toBe("durindoor/foo");
    expect(obj.provider.durindoor).toEqual({});
  });

  it("does not rewrite unrelated string values", () => {
    const input = JSON.stringify({ notes: "9router/legacy" });
    expect(rewriteProviderLabels(input, "json")).toBe(input);
  });
});

describe("Migrator merge mode", () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("backs up the pre-existing target directory before copying legacy files or rewriting", () => {
    const targetDir = join(tmp, "target");
    const legacyDir = join(tmp, "legacy");
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(targetDir, "existing.json"), '{"providers":{"9router":{}}}');
    writeFileSync(join(legacyDir, "legacy.json"), '{"x":1}');
    mkdirSync(join(legacyDir, "sub"), { recursive: true });
    writeFileSync(join(legacyDir, "sub", "y.json"), '{"y":2}');

    const backupRoot = join(tmp, "backup-9router.tar");
    const m = new Migrator({ targetDir, legacyDir, dryRun: false, backupRoot });
    m.run();

    expect(m.getMode()).toBe("merge");
    expect(m.getBackupPath()).toBeTruthy();
    expect(m.getTargetBackupPath()).toBeTruthy();

    // Target backup tar must contain the pre-existing target file, not the legacy file.
    const legacyList = spawnSync("tar", ["-tf", m.getBackupPath()], { encoding: "utf8" }).stdout;
    expect(legacyList).toContain("legacy/");
    const targetList = spawnSync("tar", ["-tf", m.getTargetBackupPath()], { encoding: "utf8" }).stdout;
    expect(targetList).toContain("target/existing.json");
    expect(targetList).not.toContain("target/legacy.json");

    // Rewrites still happened on the merged target tree.
    expect(JSON.parse(readFileSync(join(targetDir, "existing.json"), "utf8")).providers.durindoor).toBeTruthy();
  });
});

describe("Migrator restore", () => {
  let tmp;
  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("restores legacy directory from backup and removes partially-created target in move mode", () => {
    const legacyDir = join(tmp, "legacy");
    const targetDir = join(tmp, "target");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "data.txt"), "legacy data");

    const backupRoot = join(tmp, "backup.tar");
    const m = new Migrator({ targetDir, legacyDir, dryRun: false, backupRoot });
    m.setMode("move");
    // Create backup tar manually.
    const backupPath = join(tmp, "legacy-backup.tar");
    const result = spawnSync("tar", ["-cf", backupPath, "-C", tmp, "legacy"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    m.setBackupPath(backupPath);

    // Simulate a half-completed move: target exists, legacy gone.
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "half.txt"), "half");
    rmSync(legacyDir, { recursive: true, force: true });

    m.restoreFromBackup();

    expect(existsSync(targetDir)).toBe(false);
    expect(existsSync(join(legacyDir, "data.txt"))).toBe(true);
    expect(readFileSync(join(legacyDir, "data.txt"), "utf8")).toBe("legacy data");
  });
});
