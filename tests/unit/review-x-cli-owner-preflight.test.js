import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const mocks = vi.hoisted(() => ({ homedir: vi.fn() }));
vi.mock("os", () => ({ default: { homedir: mocks.homedir, platform: () => "linux" } }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200 }) },
}));
vi.mock("@/lib/cliTools/codexModelCatalog", () => ({
  loadBundledCodexCatalog: vi.fn(async () => ({})),
  buildCodexModelCatalog: vi.fn((_bundle, models) => ({ models: models.map(({ id }) => ({ slug: id, visibility: "list" })) })),
}));
vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({ buildModelsList: vi.fn(async () => []) }));

const codex = await import("@/app/api/cli-tools/codex-settings/route.js");
const cline = await import("@/app/api/cli-tools/cline-settings/route.js");
let home;
const request = () => new Request("http://localhost", { method: "POST", body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "router-key", model: "model" }) });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(process.cwd(), ".tmp-cli-owner-"));
  mocks.homedir.mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

function foreignOwner(target) {
  const lstat = fsp.lstat.bind(fsp);
  return vi.spyOn(fsp, "lstat").mockImplementation(async (file, ...args) => {
    const stat = await lstat(file, ...args);
    return file === target ? { ...stat, uid: process.geteuid() + 1 } : stat;
  });
}

it("keeps Codex files and backup on foreign config, then restores the original key on retry", async () => {
  const dir = path.join(home, ".codex");
  await fsp.mkdir(dir);
  await fsp.writeFile(path.join(dir, "config.toml"), 'model = "original"\n');
  await fsp.writeFile(path.join(dir, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "original-key" }));
  expect((await codex.POST(request())).status).toBe(200);
  const names = await fsp.readdir(dir);
  const before = await Promise.all(names.map((name) => fsp.readFile(path.join(dir, name), "utf8")));
  const owner = foreignOwner(path.join(dir, "config.toml"));
  const response = await codex.DELETE();
  expect(response.status).toBe(500);
  expect((await response.json()).error).toContain("Refusing to replace CLI config owned by uid");
  expect(await fsp.readdir(dir)).toEqual(names);
  expect(await Promise.all(names.map((name) => fsp.readFile(path.join(dir, name), "utf8")))).toEqual(before);
  owner.mockRestore();
  expect((await codex.DELETE()).status).toBe(200);
  expect(JSON.parse(await fsp.readFile(path.join(dir, "auth.json"), "utf8")).OPENAI_API_KEY).toBe("original-key");
});

it("does not change Cline global state when secrets has a foreign owner", async () => {
  const dir = path.join(home, ".cline", "data");
  await fsp.mkdir(dir, { recursive: true });
  const global = path.join(dir, "globalState.json");
  await fsp.writeFile(global, '{"original":true}');
  const secrets = path.join(dir, "secrets.json");
  await fsp.writeFile(secrets, '{}');
  foreignOwner(secrets);
  const response = await cline.POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Refusing to replace CLI config owned by uid");
  expect(await fsp.readFile(global, "utf8")).toBe('{"original":true}');
  expect(await fsp.readFile(secrets, "utf8")).toBe('{}');
});
