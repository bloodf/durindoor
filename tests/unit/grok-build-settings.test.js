// Tests for src/app/api/cli-tools/grok-build-settings/route.js (ported from decolua/9router#2571).
// Isolation: `os.homedir()` is mocked to a per-test temp dir, `child_process.exec` is mocked to
// fail (`which grok` finds nothing), and `next/server` is stubbed — the route then operates on
// real fs inside the temp dir only, never touching the developer's ~/.grok/config.toml.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

let tmpHome;
let GET, POST, DELETE;

const grokConfigPath = () => path.join(tmpHome, ".grok", "config.toml");

const callPost = (body) =>
  POST({ json: async () => body });

const responseJson = async (res) => ({ status: res.status ?? 200, body: await res.json() });

beforeEach(async () => {
  vi.resetModules();
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "grok-build-settings-test-"));

  vi.doMock("os", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, default: { ...actual, homedir: () => tmpHome }, homedir: () => tmpHome };
  });

  vi.doMock("child_process", () => ({
    exec: (_cmd, _opts, cb) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callback(new Error("not found"));
    },
  }));

  vi.doMock("next/server", () => ({
    NextResponse: {
      json: (data, init = {}) => ({
        status: init.status ?? 200,
        json: async () => data,
      }),
    },
  }));

  const route = await import("@/app/api/cli-tools/grok-build-settings/route.js");
  GET = route.GET;
  POST = route.POST;
  DELETE = route.DELETE;
});

afterEach(async () => {
  vi.doUnmock("os");
  vi.doUnmock("child_process");
  vi.doUnmock("next/server");
  vi.resetModules();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const seedConfig = (content) =>
  fs.mkdir(path.dirname(grokConfigPath()), { recursive: true }).then(() => fs.writeFile(grokConfigPath(), content));

describe("grok-build-settings route", () => {
  it("reports not installed when neither binary nor config exists", async () => {
    const { body } = await responseJson(await GET());
    expect(body.installed).toBe(false);
    expect(body.settings).toBeNull();
  });

  it("applies settings: writes [model.9router] slot and points [models].default at it", async () => {
    await seedConfig(`[models]\ndefault = "grok-build"\n\n[other]\nfoo = "bar"\n`);

    const res = await callPost({ baseUrl: "http://localhost:20128", model: "cc/claude-sonnet-4-6", apiKey: "sk_test_123" });
    const { body } = await responseJson(res);
    expect(body.success).toBe(true);

    const toml = await fs.readFile(grokConfigPath(), "utf-8");
    expect(toml).toContain('[model.9router]');
    expect(toml).toContain('model = "cc/claude-sonnet-4-6"');
    expect(toml).toContain('base_url = "http://localhost:20128/v1"');
    expect(toml).toContain('api_key = "sk_test_123"');
    expect(toml).toContain('[models]\ndefault = "9router"');
    // previous default remembered once
    expect(toml).toContain('# durindoor-prev-default = "grok-build"');
    // unrelated sections preserved
    expect(toml).toContain('[other]');
    expect(toml).toContain('foo = "bar"');
  });

  it("does not double-slash an explicit /v1 baseUrl and falls back to sk_durindoor without apiKey", async () => {
    await seedConfig("");
    const res = await callPost({ baseUrl: "http://localhost:20128/v1/", model: "m" });
    await responseJson(res);
    const toml = await fs.readFile(grokConfigPath(), "utf-8");
    expect(toml).toContain('base_url = "http://localhost:20128/v1"');
    expect(toml).toContain('api_key = "sk_durindoor"');
  });

  it("keeps the original previous default across repeated applies", async () => {
    await seedConfig(`[models]\ndefault = "my-favorite"\n`);

    await responseJson(await callPost({ baseUrl: "http://h1", model: "m1" }));
    await responseJson(await callPost({ baseUrl: "http://h2", model: "m2" }));

    const toml = await fs.readFile(grokConfigPath(), "utf-8");
    expect(toml.match(/durindoor-prev-default = "my-favorite"/g)).toHaveLength(1);
    expect(toml).not.toContain('durindoor-prev-default = "9router"');
    expect(toml).toContain('model = "m2"');
  });

  it("GET reads back saved model and default without exposing api_key", async () => {
    await seedConfig("");
    await responseJson(await callPost({ baseUrl: "http://localhost:20128", model: "cc/model", apiKey: "sk_super_secret" }));

    const { body } = await responseJson(await GET());
    expect(body.installed).toBe(true);
    expect(body.has9Router).toBe(true);
    expect(body.settings.default).toBe("9router");
    expect(body.settings.model.model).toBe("cc/model");
    expect(body.settings.model.base_url).toBe("http://localhost:20128/v1");
    // secret must not leak
    expect(JSON.stringify(body)).not.toContain("sk_super_secret");
    expect(body.settings.model.api_key).toBeUndefined();
  });

  it("DELETE restores the previous default and removes the slot, preserving unrelated TOML", async () => {
    await seedConfig(`[models]\ndefault = "grok-build"\n\n[ui]\ntheme = "dark"\n`);
    await responseJson(await callPost({ baseUrl: "http://localhost:20128", model: "m" }));

    const { body } = await responseJson(await DELETE());
    expect(body.success).toBe(true);

    const toml = await fs.readFile(grokConfigPath(), "utf-8");
    expect(toml).not.toContain("[model.9router]");
    expect(toml).not.toContain("durindoor-prev-default");
    expect(toml).toContain('[models]\ndefault = "grok-build"');
    expect(toml).toContain('[ui]');
    expect(toml).toContain('theme = "dark"');
  });

  it("DELETE falls back to the built-in grok-build default when no marker exists", async () => {
    await seedConfig(`[models]\ndefault = "9router"\n\n[model.9router]\nmodel = "m"\nbase_url = "http://x/v1"\n`);
    await responseJson(await DELETE());
    const toml = await fs.readFile(grokConfigPath(), "utf-8");
    expect(toml).toContain('[models]\ndefault = "grok-build"');
    expect(toml).not.toContain("[model.9router]");
  });

  it("DELETE leaves a foreign default untouched while removing the slot", async () => {
    await seedConfig(`[models]\ndefault = "someone-else"\n\n[model.9router]\nmodel = "m"\nbase_url = "http://x/v1"\n`);
    await responseJson(await DELETE());
    const toml = await fs.readFile(grokConfigPath(), "utf-8");
    expect(toml).toContain('default = "someone-else"');
    expect(toml).not.toContain("[model.9router]");
  });

  it("rejects TOML-breaking model/apiKey values with 400 and writes nothing", async () => {
    for (const model of ['evil"\n[pwned]', "back\\slash", "line\nbreak", "ctrl\x01"]) {
      const { status } = await responseJson(await callPost({ baseUrl: "http://localhost:20128", model }));
      expect(status).toBe(400);
    }
    const { status } = await responseJson(await callPost({ baseUrl: "http://localhost:20128", model: "ok", apiKey: 'bad"key' }));
    expect(status).toBe(400);
    await expect(fs.access(grokConfigPath())).rejects.toThrow();
  });

  it("rejects non-http baseUrl with 400", async () => {
    const { status } = await responseJson(await callPost({ baseUrl: "ftp://example.com", model: "m" }));
    expect(status).toBe(400);
    const { status: s2 } = await responseJson(await callPost({ baseUrl: "not a url", model: "m" }));
    expect(status).toBe(400);
    expect(s2).toBe(400);
    // non-string baseUrl must not coerce through new URL()
    const { status: s3 } = await responseJson(await callPost({ baseUrl: ["http://localhost:20128"], model: "m" }));
    expect(s3).toBe(400);
  });

  it("requires baseUrl and model", async () => {
    const { status } = await responseJson(await callPost({ model: "m" }));
    expect(status).toBe(400);
  });
});
