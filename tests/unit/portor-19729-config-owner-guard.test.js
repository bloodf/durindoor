import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeConfigAtomic } from "../../src/lib/cliTools/readExistingConfig.js";

// The test process cannot chown, so it pretends to be a different uid than the file owner.
describe.skipIf(process.platform === "win32")("OmniRoute #19729 - CLI config writes keep the file owner", () => {
  let home;
  let previousHome;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "portor-19729-"));
    previousHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  const pretendForeignUid = () => vi.spyOn(process, "geteuid").mockReturnValue(process.getuid() + 1);

  it("refuses to replace another uid's config and leaves it untouched", async () => {
    const target = path.join(home, "config.toml");
    await fs.writeFile(target, "original");
    pretendForeignUid();

    await expect(writeConfigAtomic(target, "replaced")).rejects.toMatchObject({ code: "CLI_CONFIG_FOREIGN_OWNER" });

    expect(await fs.readFile(target, "utf-8")).toBe("original");
    expect(await fs.readdir(home)).toEqual(["config.toml"]);
  });

  it("checks the owner of a symlink's target", async () => {
    const target = path.join(home, "real.toml");
    const link = path.join(home, "config.toml");
    await fs.writeFile(target, "original");
    await fs.symlink(target, link);
    pretendForeignUid();

    await expect(writeConfigAtomic(link, "replaced")).rejects.toMatchObject({ code: "CLI_CONFIG_FOREIGN_OWNER" });
    expect(await fs.readFile(target, "utf-8")).toBe("original");
  });

  it("still creates a missing config and replaces an owned one", async () => {
    const target = path.join(home, "config.toml");
    await writeConfigAtomic(target, "first");
    await writeConfigAtomic(target, "second");
    expect(await fs.readFile(target, "utf-8")).toBe("second");
  });

  it("leaves both Hermes files untouched when .env belongs to another uid", async () => {
    const hermesDir = path.join(home, ".hermes");
    const envPath = path.join(hermesDir, ".env");
    await fs.mkdir(hermesDir, { recursive: true });
    await fs.writeFile(envPath, "OPENAI_API_KEY=old\n");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    pretendForeignUid();
    const { POST } = await import("@/app/api/cli-tools/hermes-settings/route.js");

    const response = await POST(new Request("http://localhost/api/cli-tools/hermes-settings", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk_new", model: "cc/claude-sonnet-4-6" }),
    }));

    expect(response.status).toBe(500);
    expect(await fs.readFile(envPath, "utf-8")).toBe("OPENAI_API_KEY=old\n");
    expect(await fs.readdir(hermesDir)).toEqual([".env"]);
  });
});
