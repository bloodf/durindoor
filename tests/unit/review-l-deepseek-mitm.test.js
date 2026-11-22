import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseTOML } from "confbox";

let tmpHome;
const loadRoute = () => import("@/app/api/cli-tools/deepseek-tui-settings/route.js");
const post = (route, body) => route.POST({ json: async () => body });

beforeEach(async () => {
  vi.resetModules();
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "review-l-deepseek-"));
  vi.doMock("os", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, default: { ...actual, homedir: () => tmpHome }, homedir: () => tmpHome };
  });
  vi.doMock("child_process", () => ({ exec: (_command, options, callback) => (options || callback)(new Error("missing")) }));
  vi.doMock("next/server", () => ({ NextResponse: { json: (data, init = {}) => ({ status: init.status ?? 200, json: async () => data }) } }));
});

afterEach(async () => {
  vi.doUnmock("os");
  vi.doUnmock("child_process");
  vi.doUnmock("next/server");
  vi.resetModules();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("DeepSeek TUI settings TOML writer", () => {
  it("escapes TOML strings and preserves unrelated config while merging settings", async () => {
    const configPath = path.join(tmpHome, ".deepseek", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, '[ui]\ntheme = "dark"\n\n[providers.openai]\napi_key = "keep-me"\n');
    const route = await loadRoute();
    const response = await post(route, { baseUrl: "http://localhost:20128", model: 'model "quoted"' });
    expect(response.status).toBe(200);
    const config = parseTOML(await fs.readFile(configPath, "utf8"));
    expect(config.ui.theme).toBe("dark");
    expect(config.providers.openai).toMatchObject({
      api_key: "keep-me",
      base_url: "http://localhost:20128/v1",
      model: 'model "quoted"',
    });
  });

  it("rejects control characters in values without changing the config", async () => {
    const configPath = path.join(tmpHome, ".deepseek", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'provider = "deepseek"\n');
    const route = await loadRoute();
    const response = await post(route, { baseUrl: "http://localhost:20128", model: "ok\n[evil]" });
    expect(response.status).toBe(400);
    expect(await fs.readFile(configPath, "utf8")).toBe('provider = "deepseek"\n');
  });
});

describe("per-user MITM lock ports", () => {
  it("derives separate startup and Root CA lock ports from the OS uid", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const config = require("../../src/mitm/config.js");
    const uid = process.getuid?.() ?? 0;
    expect(config.MITM_START_LOCK_PORT).toBe(30000 + ((uid % 10000) * 2));
    expect(config.ROOT_CA_LOCK_PORT).toBe(config.MITM_START_LOCK_PORT + 1);
    expect(config.ROOT_CA_LOCK_PORT).not.toBe(20444);
  });
});
