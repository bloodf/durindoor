import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML } from "confbox";

let home;
const file = (dir) => path.join(home, dir, "config.toml");
const seed = async (dir, content) => {
  await fs.mkdir(path.dirname(file(dir)), { recursive: true });
  await fs.writeFile(file(dir), content);
};
const route = () => import("@/app/api/cli-tools/codewhale-settings/route.js");
const post = (r) => r.POST({ json: async () => ({ baseUrl: "http://localhost:20128", model: "new" }) });

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codewhale-port-"));
  vi.resetModules();
  vi.doMock("os", async (original) => { const actual = await original(); return { ...actual, default: { ...actual, homedir: () => home } }; });
  vi.doMock("child_process", () => ({ exec: (_cmd, opts, cb) => (typeof opts === "function" ? opts : cb)(new Error("not found")) }));
  vi.doMock("next/server", () => ({ NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, json: async () => body }) } }));
});
afterEach(async () => {
  vi.doUnmock("os"); vi.doUnmock("child_process"); vi.doUnmock("next/server"); vi.resetModules();
  await fs.rm(home, { recursive: true, force: true });
});

describe("CodeWhale legacy migration", () => {
  it("reads, migrates and resets the legacy config while preserving unrelated settings and the secret", async () => {
    await seed(".deepseek", 'provider = "openai"\n[providers.openai]\nbase_url = "http://localhost:20128/v1"\napi_key = "secret-value"\nextra = "keep"\n[providers.other]\nname = "other"\n');
    const r = await route();
    const status = await (await r.GET()).json();
    expect(status).toMatchObject({ installed: true, has9Router: true, configPath: file(".deepseek") });
    expect(JSON.stringify(status)).not.toContain("secret-value");
    expect((await post(r)).status).toBe(200);
    const written = parseTOML(await fs.readFile(file(".deepseek"), "utf8"));
    expect(written.openai).toMatchObject({ api_key: "secret-value", extra: "keep", model: "new" });
    expect(written.providers).toEqual({ other: { name: "other" } });
    expect((await r.DELETE()).status).toBe(200);
    expect(parseTOML(await fs.readFile(file(".deepseek"), "utf8"))).toEqual({ provider: "openai", providers: { other: { name: "other" } } });
  });

  it("prefers primary and leaves unmanaged configs untouched", async () => {
    await seed(".deepseek", '[providers.openai]\nbase_url = "http://localhost:20128"\n');
    const primary = '[openai]\nbase_url = "https://example.com"\napi_key = "primary-secret"\n';
    await seed(".codewhale", primary);
    const r = await route();
    expect((await (await r.GET()).json()).configPath).toBe(file(".codewhale"));
    await r.DELETE();
    expect(await fs.readFile(file(".codewhale"), "utf8")).toBe(primary);
    await post(r);
    expect(parseTOML(await fs.readFile(file(".codewhale"), "utf8")).openai.api_key).toBe("primary-secret");
    expect(await fs.readFile(file(".deepseek"), "utf8")).toContain("providers.openai");
  });

  it.each([".codewhale", ".deepseek"])("refuses to overwrite malformed %s config", async (dir) => {
    await seed(dir, "broken = [");
    const r = await route();
    expect((await r.GET()).status).toBe(200);
    expect((await post(r)).status).toBe(500);
    expect((await r.DELETE()).status).toBe(500);
    expect(await fs.readFile(file(dir), "utf8")).toBe("broken = [");
  });
});
import { detectClientTool } from "../../open-sse/utils/clientDetector.js";

describe("CodeWhale client detection", () => {
  it("recognizes current and legacy user agents for the same streaming behavior", () => {
    expect(detectClientTool({ "user-agent": "CodeWhale/1.0" })).toBe("deepseek-tui");
    expect(detectClientTool({ "user-agent": "deepseek-tui/1.0" })).toBe("deepseek-tui");
  });
});
