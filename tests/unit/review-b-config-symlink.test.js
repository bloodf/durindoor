import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "config-symlink-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("atomic CLI config writes", () => {
  it("updates a symlink target and keeps the backup beside the target", async () => {
    const targetDir = path.join(dir, "dotfiles");
    await fs.mkdir(targetDir);
    const target = path.join(targetDir, "settings.json");
    const link = path.join(dir, "settings.json");
    await fs.writeFile(target, "old");
    await fs.symlink(path.relative(dir, target), link);
    await writeConfigAtomic(link, "new");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("new");
    expect(await fs.readFile(`${target}.bak`, "utf8")).toBe("old");
    await expect(fs.lstat(`${link}.bak`)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(`${target}.bak`)).mode & 0o777).toBe(0o600);
  });

  it("updates a regular file", async () => {
    const file = path.join(dir, "config");
    await fs.writeFile(file, "old");
    await writeConfigAtomic(file, "new");
    expect(await fs.readFile(file, "utf8")).toBe("new");
    expect(await fs.readFile(`${file}.bak`, "utf8")).toBe("old");
  });

  it("creates a missing file", async () => {
    const file = path.join(dir, "config");
    await writeConfigAtomic(file, "new");
    expect(await fs.readFile(file, "utf8")).toBe("new");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("creates the target of a dangling relative symlink", async () => {
    const target = path.join(dir, "target");
    const link = path.join(dir, "link");
    await fs.symlink("target", link);
    await writeConfigAtomic(link, "new");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("new");
  });
});
