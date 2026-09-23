// Tests for the Pi, Crush, ForgeCode, Smelt and CodeWhale settings routes (upstream 6c9fe6f).
// `os.homedir()` points at a per-test temp dir and `which <tool>` always fails, so the routes
// only ever touch files inside that temp dir.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML } from "confbox";

let tmpHome;

const loadRoute = (name) => import(`@/app/api/cli-tools/${name}-settings/route.js`);
const post = (route, body) => route.POST({ json: async () => body });
const read = async (res) => ({ status: res.status, body: await res.json() });
const seed = async (rel, content) => {
  const file = path.join(tmpHome, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
};

const APPLY = { baseUrl: "http://localhost:20128", apiKey: "sk-test-secret", model: "cc/claude-sonnet-4-6" };

beforeEach(async () => {
  vi.resetModules();
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "generic-cli-settings-test-"));
  vi.stubEnv("XDG_CONFIG_HOME", "");
  vi.doMock("os", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, default: { ...actual, homedir: () => tmpHome }, homedir: () => tmpHome };
  });
  vi.doMock("child_process", () => ({
    exec: (_cmd, opts, cb) => (typeof opts === "function" ? opts : cb)(new Error("not found")),
  }));
  vi.doMock("next/server", () => ({
    NextResponse: { json: (data, init = {}) => ({ status: init.status ?? 200, json: async () => data }) },
  }));
});

afterEach(async () => {
  vi.doUnmock("os");
  vi.doUnmock("child_process");
  vi.doUnmock("next/server");
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe.each(["pi", "crush", "forge", "smelt", "codewhale"])("%s-settings route", (name) => {
  it("reports not installed when neither binary nor config exists", async () => {
    const { body } = await read(await (await loadRoute(name)).GET());
    expect(body).toMatchObject({ installed: false, config: null });
  });

  it("rejects a POST without baseUrl", async () => {
    const { status } = await read(await post(await loadRoute(name), { model: "x" }));
    expect(status).toBe(400);
  });

  it("applies, reports configured with the key redacted, then resets", async () => {
    const route = await loadRoute(name);
    const applied = await read(await post(route, APPLY));
    expect(applied.status).toBe(200);
    expect(applied.body.success).toBe(true);

    const status = await read(await route.GET());
    expect(status.body.installed).toBe(true);
    expect(status.body.has9Router).toBe(true);
    expect(JSON.stringify(status.body.config)).not.toContain("sk-test-secret");

    const reset = await read(await route.DELETE());
    expect(reset.body.success).toBe(true);
    const after = await read(await route.GET());
    expect(after.body.has9Router).not.toBe(true);
  });

  it("resets cleanly when no config file exists", async () => {
    const { status, body } = await read(await (await loadRoute(name)).DELETE());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("pi-settings", () => {
  it("writes providers.durindoor with the model list, keeps other providers, drops legacy 9router", async () => {
    const file = await seed(".pi/agent/models.json", JSON.stringify({
      providers: { other: { baseUrl: "https://x.example/v1" }, "9router": { baseUrl: "http://localhost:20128/v1" } },
    }));
    const route = await loadRoute("pi");
    await post(route, { baseUrl: "http://localhost:20128", apiKey: "k", models: ["a/b", { id: "c/d", maxTokens: 999 }] });

    const cfg = JSON.parse(await fs.readFile(file, "utf-8"));
    expect(cfg.providers.other).toEqual({ baseUrl: "https://x.example/v1" });
    expect(cfg.providers["9router"]).toBeUndefined();
    expect(cfg.providers.durindoor).toMatchObject({ baseUrl: "http://localhost:20128/v1", apiKey: "k", api: "openai-completions" });
    expect(cfg.providers.durindoor.models).toEqual([
      { id: "a/b", name: "a/b", contextWindow: 128000, maxTokens: 16384 },
      { id: "c/d", name: "c/d", contextWindow: 128000, maxTokens: 999 },
    ]);

    await route.DELETE();
    expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual({ providers: { other: { baseUrl: "https://x.example/v1" } } });
  });

  it("counts a legacy providers.9router entry as configured", async () => {
    await seed(".pi/agent/models.json", JSON.stringify({ providers: { "9router": { baseUrl: "https://gw.example/v1" } } }));
    const { body } = await read(await (await loadRoute("pi")).GET());
    expect(body.has9Router).toBe(true);
  });

  it("refuses to overwrite malformed models.json", async () => {
    const file = await seed(".pi/agent/models.json", "{ not json");
    const { status, body } = await read(await post(await loadRoute("pi"), APPLY));
    expect(status).toBe(500);
    expect(body.error).toContain("refusing to overwrite it");
    expect(await fs.readFile(file, "utf-8")).toBe("{ not json");
  });
});

describe("crush-settings", () => {
  it("writes an openai-compat providers.durindoor entry and honours XDG_CONFIG_HOME", async () => {
    const xdg = path.join(tmpHome, "xdg");
    vi.stubEnv("XDG_CONFIG_HOME", xdg);
    await post(await loadRoute("crush"), APPLY);
    const cfg = JSON.parse(await fs.readFile(path.join(xdg, "crush", "crush.json"), "utf-8"));
    expect(cfg.providers.durindoor).toEqual({
      type: "openai-compat",
      base_url: "http://localhost:20128/v1",
      api_key: "sk-test-secret",
      models: [{ id: APPLY.model, name: APPLY.model, context_window: 128000 }],
    });
  });

  it("refuses to overwrite a non-object crush.json", async () => {
    const file = await seed(".config/crush/crush.json", "[1,2]");
    const { status } = await read(await post(await loadRoute("crush"), APPLY));
    expect(status).toBe(500);
    expect(await fs.readFile(file, "utf-8")).toBe("[1,2]");
  });
});

describe.each([
  ["forge", ".forge/config.toml"],
  ["codewhale", ".codewhale/config.toml"],
])("%s-settings TOML", (name, rel) => {
  it("sets [openai], keeps other tables, and reset keeps them too", async () => {
    const file = await seed(rel, `[ui]\ntheme = "dark"\n`);
    const route = await loadRoute(name);
    await post(route, APPLY);

    const raw = await fs.readFile(file, "utf-8");
    expect(raw).toContain("managed by DurinDoor");
    const cfg = parseTOML(raw);
    expect(cfg.ui).toEqual({ theme: "dark" });
    expect(cfg.openai).toEqual({ api_key: "sk-test-secret", base_url: "http://localhost:20128/v1", model: APPLY.model });

    await route.DELETE();
    expect(parseTOML(await fs.readFile(file, "utf-8"))).toEqual({ ui: { theme: "dark" } });
  });

  it("does not remove a user-owned [openai] table on reset", async () => {
    const content = `[openai]\nbase_url = "https://api.openai.com/v1"\n`;
    const file = await seed(rel, content);
    const { body } = await read(await (await loadRoute(name)).DELETE());
    expect(body.success).toBe(true);
    expect(await fs.readFile(file, "utf-8")).toBe(content);
  });

  it("refuses to overwrite malformed TOML", async () => {
    const file = await seed(rel, "model = = broken\n");
    const { status } = await read(await post(await loadRoute(name), APPLY));
    expect(status).toBe(500);
    expect(await fs.readFile(file, "utf-8")).toBe("model = = broken\n");
  });
});

describe("smelt-settings", () => {
  it("merges endpoint keys with a durindoor marker and reset leaves other keys", async () => {
    const file = await seed(".smelt/config.json", JSON.stringify({ theme: "dark", model: "old" }));
    const route = await loadRoute("smelt");
    await post(route, { baseUrl: "http://localhost:20128/v1", apiKey: "k" });

    expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual({
      theme: "dark",
      baseUrl: "http://localhost:20128/v1",
      apiKey: "k",
      model: "old",
      _managedBy: "durindoor",
    });

    await route.DELETE();
    expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual({ theme: "dark" });
  });

  it("leaves a config not managed by DurinDoor untouched on reset", async () => {
    const content = JSON.stringify({ baseUrl: "https://api.openai.com/v1", apiKey: "mine" });
    const file = await seed(".smelt/config.json", content);
    await (await loadRoute("smelt")).DELETE();
    expect(await fs.readFile(file, "utf-8")).toBe(content);
  });
});

describe("all-statuses", () => {
  it("includes the new CLI tools", async () => {
    const { GET } = await import("@/app/api/cli-tools/all-statuses/route.js");
    const { body } = await read(await GET());
    for (const id of ["pi", "crush", "forge", "smelt", "codewhale"]) {
      expect(body[id]).toMatchObject({ installed: false });
    }
  });
});
