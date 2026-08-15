import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

let xdgRoot;
let POST;

const jsonPath = () => path.join(xdgRoot, "opencode", "opencode.json");
const jsoncPath = () => path.join(xdgRoot, "opencode", "opencode.jsonc");
const responseJson = async (response) => ({ status: response.status ?? 200, body: await response.json() });

beforeEach(async () => {
  vi.resetModules();
  xdgRoot = await fs.mkdtemp(path.join(os.tmpdir(), "durindoor-opencode-jsonc-"));
  vi.stubEnv("XDG_CONFIG_HOME", xdgRoot);
  vi.doMock("child_process", () => ({ exec: (_command, _options, callback) => callback(new Error("not found")) }));
  vi.doMock("next/server", () => ({
    NextResponse: { json: (data, init = {}) => ({ status: init.status ?? 200, json: async () => data }) },
  }));
  ({ POST } = await import("@/app/api/cli-tools/opencode-settings/route.js"));
});

afterEach(async () => {
  vi.doUnmock("child_process");
  vi.doUnmock("next/server");
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(xdgRoot, { recursive: true, force: true });
});

const apply = () => POST({ json: async () => ({ baseUrl: "http://localhost:20128", apiKey: "sk-test", models: ["catalog-model"] }) });

describe("OpenCode JSONC settings", () => {
  it("prefers XDG opencode.jsonc and preserves comments and trailing commas when applying settings", async () => {
    const original = `{
  // keep this comment
  "provider": {
    "custom": {
      // keep nested comment
      "name": "Custom",
    },
  },
}\n`;
    await fs.mkdir(path.dirname(jsoncPath()), { recursive: true });
    await fs.writeFile(jsoncPath(), original);
    await fs.writeFile(jsonPath(), "{\"provider\": {\"json\": {}}}");

    const { status, body } = await responseJson(await apply());
    expect(status).toBe(200);
    expect(body.configPath).toBe(jsoncPath());
    expect(await fs.readFile(jsoncPath(), "utf8")).toContain("// keep this comment");
    expect(await fs.readFile(jsoncPath(), "utf8")).toContain("// keep nested comment");
    expect(await fs.readFile(jsoncPath(), "utf8")).toContain('"catalog-model"');
    expect(await fs.readFile(jsonPath(), "utf8")).toBe('{"provider": {"json": {}}}');
  });

  it("refuses to overwrite invalid selected JSONC", async () => {
    const invalid = "{ invalid jsonc\n";
    await fs.mkdir(path.dirname(jsoncPath()), { recursive: true });
    await fs.writeFile(jsoncPath(), invalid);

    const { status, body } = await responseJson(await apply());
    expect(status).toBe(500);
    expect(body.error).toMatch(/invalid JSONC|refusing to overwrite/i);
    expect(await fs.readFile(jsoncPath(), "utf8")).toBe(invalid);
  });
  it("keeps the provider when deleting an absent model", async () => {
    const original = `{
  // provider comment
  "provider": { "9router": { "models": { "kept": {} } } }
}\n`;
    await fs.mkdir(path.dirname(jsoncPath()), { recursive: true });
    await fs.writeFile(jsoncPath(), original);
    const { DELETE } = await import("@/app/api/cli-tools/opencode-settings/route.js");

    const { status } = await responseJson(await DELETE({ url: "http://localhost/?model=absent" }));
    expect(status).toBe(200);
    expect(await fs.readFile(jsoncPath(), "utf8")).toBe(original);
  });
});
