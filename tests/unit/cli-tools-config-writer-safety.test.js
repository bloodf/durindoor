import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  homedir: vi.fn(),
  platform: vi.fn(() => "linux"),
}));

vi.mock("os", () => ({
  default: { homedir: mocks.homedir, platform: mocks.platform },
  homedir: mocks.homedir,
  platform: mocks.platform,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  },
}));

const copilot = await import("@/app/api/cli-tools/copilot-settings/route.js");
const codex = await import("@/app/api/cli-tools/codex-settings/route.js");

let home;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(process.cwd(), ".tmp-cli-config-"));
  mocks.homedir.mockReturnValue(home);
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

function post(handler, body) {
  return handler(new Request("http://localhost/api/cli-tools/settings", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

const copilotBody = {
  baseUrl: "http://localhost:20128",
  apiKey: "sk-test",
  models: ["coding-default"],
};

const codexBody = {
  baseUrl: "http://localhost:20128",
  apiKey: "sk-test",
  model: "coding-default",
};

describe("Copilot settings writer", () => {
  it.each([
    ["malformed JSON", "[{\"name\":\"Other\""],
    ["non-array JSON", "{\"name\":\"Other\"}"],
  ])("refuses %s without changing the existing file", async (_label, contents) => {
    const configPath = path.join(home, ".config", "Code", "User", "chatLanguageModels.json");
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, contents);

    const response = await post(copilot.POST, copilotBody);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(configPath, "utf8")).toBe(contents);
  });

  it("refuses an unreadable existing path", async () => {
    const configPath = path.join(home, ".config", "Code", "User", "chatLanguageModels.json");
    await fsp.mkdir(configPath, { recursive: true });

    const response = await post(copilot.POST, copilotBody);

    expect(response.status).toBe(500);
    expect((await fsp.stat(configPath)).isDirectory()).toBe(true);
  });

  it("initializes an absent config", async () => {
    const response = await post(copilot.POST, copilotBody);
    const configPath = path.join(home, ".config", "Code", "User", "chatLanguageModels.json");

    expect(response.status).toBe(200);
    const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
    expect(config).toHaveLength(1);
    expect(config[0]).toMatchObject({ name: "DurinDoor", apiKey: "sk-test" });
  });
});

describe("Codex settings writer", () => {
  it.each([
    ["invalid assignment", "model = = broken\n"],
    ["number", "42"],
    ["boolean", "true"],
    ["string", '"value"'],
    ["array-like", "[]"],
    ["null-like", "null"],
  ])("refuses %s config.toml without changing either file", async (_label, configContents) => {
    const codexDir = path.join(home, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    const authContents = '{"tokens":{"access":"keep-me"}}';
    await fsp.mkdir(codexDir, { recursive: true });
    await fsp.writeFile(configPath, configContents);
    await fsp.writeFile(authPath, authContents);

    const response = await post(codex.POST, codexBody);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(configPath, "utf8")).toBe(configContents);
    expect(await fsp.readFile(authPath, "utf8")).toBe(authContents);
  });

  it("refuses malformed auth.json without changing either file", async () => {
    const codexDir = path.join(home, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    const configContents = 'model = "keep-me"\n';
    const authContents = "{\"tokens\": {\"access\": \"keep-me\"";
    await fsp.mkdir(codexDir, { recursive: true });
    await fsp.writeFile(configPath, configContents);
    await fsp.writeFile(authPath, authContents);

    const response = await post(codex.POST, codexBody);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(configPath, "utf8")).toBe(configContents);
    expect(await fsp.readFile(authPath, "utf8")).toBe(authContents);
  });

  it.each([
    ["string", '"keep-me"'],
    ["number", "42"],
    ["boolean", "true"],
    ["array", '[{"token":"keep-me"}]'],
    ["null", "null"],
  ])("refuses %s auth.json without changing either file", async (_label, authContents) => {
    const codexDir = path.join(home, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    const configContents = 'model = "keep-me"\n';
    await fsp.mkdir(codexDir, { recursive: true });
    await fsp.writeFile(configPath, configContents);
    await fsp.writeFile(authPath, authContents);

    const response = await post(codex.POST, codexBody);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(configPath, "utf8")).toBe(configContents);
    expect(await fsp.readFile(authPath, "utf8")).toBe(authContents);
  });

  it("refuses an unreadable existing config path without changing auth.json", async () => {
    const codexDir = path.join(home, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    const authContents = '{"tokens":{"access":"keep-me"}}';
    await fsp.mkdir(configPath, { recursive: true });
    await fsp.writeFile(authPath, authContents);

    const response = await post(codex.POST, codexBody);

    expect(response.status).toBe(500);
    expect((await fsp.stat(configPath)).isDirectory()).toBe(true);
    expect(await fsp.readFile(authPath, "utf8")).toBe(authContents);
  });

  it("refuses an unreadable existing auth path without changing config.toml", async () => {
    const codexDir = path.join(home, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    const configContents = 'model = "keep-me"\n';
    await fsp.mkdir(codexDir, { recursive: true });
    await fsp.writeFile(configPath, configContents);
    await fsp.mkdir(authPath);

    const response = await post(codex.POST, codexBody);

    expect(response.status).toBe(500);
    expect(await fsp.readFile(configPath, "utf8")).toBe(configContents);
    expect((await fsp.stat(authPath)).isDirectory()).toBe(true);
  });

  it("initializes absent config and auth files", async () => {
    const response = await post(codex.POST, codexBody);

    expect(response.status).toBe(200);
    const config = await fsp.readFile(path.join(home, ".codex", "config.toml"), "utf8");
    const auth = JSON.parse(await fsp.readFile(path.join(home, ".codex", "auth.json"), "utf8"));
    expect(config).toContain('name = "DurinDoor"');
    expect(auth).toMatchObject({ OPENAI_API_KEY: "sk-test", auth_mode: "apikey" });
  });
});
