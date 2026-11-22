import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const mocks = vi.hoisted(() => ({ homedir: vi.fn() }));
vi.mock("os", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, default: { ...original.default, homedir: mocks.homedir }, homedir: mocks.homedir };
});
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200 }) },
}));

const cline = await import("@/app/api/cli-tools/cline-settings/route.js");
const kilo = await import("@/app/api/cli-tools/kilo-settings/route.js");
const jcode = await import("@/app/api/cli-tools/jcode-settings/route.js");
const { writeConfigAtomic } = await import("@/lib/cliTools/readExistingConfig");
let home;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "cli-write-"));
  mocks.homedir.mockReturnValue(home);
});
afterEach(async () => fs.rm(home, { recursive: true, force: true }));

describe("CLI config safety", () => {
  it.each([
    ["cline", cline, ".cline/data/globalState.json", "{broken"],
    ["kilo", kilo, ".local/share/kilo/auth.json", "{broken"],
    ["jcode", jcode, ".jcode/config.toml", "invalid = ["],
  ])("refuses malformed %s config without overwriting", async (_name, route, relative, contents) => {
    const file = path.join(home, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
    const response = await route.POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ baseUrl: "http://localhost", apiKey: "secret", model: "model" }),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("refusing to overwrite");
    expect(await fs.readFile(file, "utf8")).toBe(contents);
  });

  it("replaces atomically with a private single backup", async () => {
    const file = path.join(home, "config");
    await fs.writeFile(file, "old");
    await writeConfigAtomic(file, "new");
    expect(await fs.readFile(file, "utf8")).toBe("new");
    expect(await fs.readFile(file + ".bak", "utf8")).toBe("old");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(file + ".bak")).mode & 0o777).toBe(0o600);
    await writeConfigAtomic(file, "newer");
    expect(await fs.readFile(file + ".bak", "utf8")).toBe("new");
    expect((await fs.readdir(home)).sort()).toEqual(["config", "config.bak"]);
  });
});
