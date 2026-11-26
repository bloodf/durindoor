import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const mocks = vi.hoisted(() => ({ homedir: vi.fn(), platform: vi.fn(() => "linux") }));

vi.mock("os", () => ({
  default: { homedir: mocks.homedir, platform: mocks.platform },
  homedir: mocks.homedir,
  platform: mocks.platform,
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200 }) },
}));
vi.mock("@/lib/cliTools/codexModelCatalog", () => ({
  loadBundledCodexCatalog: vi.fn(async () => ({})),
  buildCodexModelCatalog: vi.fn((_bundled, models) => ({
    models: models.map((model) => ({ slug: model.id, visibility: "list" })),
  })),
}));
vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({ buildModelsList: vi.fn(async () => []) }));

const codex = await import("@/app/api/cli-tools/codex-settings/route.js");

let codexDir;
const file = (name) => path.join(codexDir, name);
const read = (name) => fsp.readFile(file(name), "utf8");
const apply = (model = "coding-default") => codex.POST(new Request("http://localhost/api/cli-tools/codex-settings", {
  method: "POST",
  body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test", model }),
}));
/** Fail the rename that publishes `name`, as a full disk or a locked file would. */
function failPublishing(name) {
  const rename = fsp.rename.bind(fsp);
  vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
    if (path.basename(to) === name) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    return rename(from, to);
  });
}

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(process.cwd(), ".tmp-codex-20105-"));
  mocks.homedir.mockReturnValue(home);
  codexDir = path.join(home, ".codex");
  fs.mkdirSync(codexDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(path.dirname(codexDir), { recursive: true, force: true });
});

describe("OmniRoute #20105 - safer Codex settings writes", () => {
  it("keeps the old model catalog when the new one cannot be published", async () => {
    await fsp.writeFile(file("durindoor-models.json"), "old catalog");
    failPublishing("durindoor-models.json");

    const response = await apply();

    expect((await response.json()).catalogWarning).toContain("Could not write");
    expect(await read("durindoor-models.json")).toBe("old catalog");
  });

  it("does not rewrite an unchanged model catalog", async () => {
    await apply();
    const longAgo = new Date("2020-01-01T00:00:00Z");
    await fsp.utimes(file("durindoor-models.json"), longAgo, longAgo);

    await apply();

    expect((await fsp.stat(file("durindoor-models.json"))).mtime).toEqual(longAgo);
  });
});
