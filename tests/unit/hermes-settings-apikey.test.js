// Tests for src/app/api/cli-tools/hermes-settings/route.js (ported from decolua/9router#3235).
// Goal: POST writes a `model:` block whose YAML contains an `api_key` line that
// resolves to the companion OPENAI_API_KEY env var, and GET (via parseModelBlock)
// reads that api_key back so the YAML round-trips.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const cardSource = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(
    resolve(here, "../../src/app/(dashboard)/dashboard/cli-tools/components/HermesToolCard.js"),
    "utf-8",
  );
})();

describe("HermesToolCard manual config builder", () => {
  it("references the Hermes OPENAI_API_KEY environment variable in the manual YAML", () => {
    expect(cardSource).toMatch(/api_key:[ \t]*\\\$\{OPENAI_API_KEY\}/);
  });

  it("never embeds the secret key value inside the manual YAML", () => {
    const yamlSnippet = cardSource.match(/yamlContent\s*=\s*`([\s\S]*?)`/);
    expect(yamlSnippet).not.toBeNull();
    expect(yamlSnippet[1]).not.toMatch(/keyToUse/);
  });

  it("does not use the misleading ${apiKey} placeholder", () => {
    expect(cardSource).not.toMatch(/api_key:[ \t]*"\\\$\{apiKey\}"/);
  });
});

const mocks = vi.hoisted(() => ({
  homedir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  exec: vi.fn(),
  platform: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    access: mocks.access,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
  },
  access: mocks.access,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));

vi.mock("os", () => ({
  default: {
    homedir: mocks.homedir,
    platform: mocks.platform,
  },
  homedir: mocks.homedir,
  platform: mocks.platform,
}));

vi.mock("child_process", () => ({
  exec: mocks.exec,
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual("next/server");
  return {
    ...actual,
    NextResponse: {
      json: (body, init) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  };
});

const { POST, GET } = await import("@/app/api/cli-tools/hermes-settings/route.js");

describe("hermes-settings api_key (port of decolua/9router#3235)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.homedir.mockReturnValue("/home/test");
    mocks.platform.mockReturnValue("linux");
    // No hermes binary on PATH, but config file exists — GET should treat it as installed.
    mocks.exec.mockImplementation((_cmd, _opts, cb) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callback(new Error("not found"));
    });
    mocks.readFile.mockRejectedValue({ code: "ENOENT" });
    mocks.writeFile.mockResolvedValue();
    mocks.mkdir.mockResolvedValue();
  });

  async function postBody(body) {
    const request = new Request("http://localhost/api/cli-tools/hermes-settings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return POST(request);
  }

  it.each([undefined, null])("POST treats API key %s as absent and writes only the Hermes config", async (apiKey) => {
    const response = await postBody({
      baseUrl: "http://localhost:20128",
      apiKey,
      model: "cc/claude-sonnet-4-6",
    });

    expect(response.status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const yaml = mocks.writeFile.mock.calls[0][1];
    expect(yaml).toMatch(/^model:[ \t]*\r?\n/m);
    expect(yaml).toMatch(/api_key:[ \t]*"?\$\{OPENAI_API_KEY\}"?/m);
  });

  it("POST writes only an environment reference to config.yaml and stores a supplied key in Hermes .env", async () => {
    const apiKey = "sk_live_unsafe-looking-but-valid";
    const response = await postBody({
      baseUrl: "http://localhost:20128",
      apiKey,
      model: "cc/claude-sonnet-4-6",
    });

    expect(response.status).toBe(200);
    const yaml = mocks.writeFile.mock.calls[0][1];
    expect(yaml).toMatch(/^model:[ \t]*\r?\n/m);
    expect(yaml).toMatch(/api_key:[ \t]*"?\$\{OPENAI_API_KEY\}"?/m);
    expect(yaml).not.toContain(apiKey);
    expect(yaml).toMatch(/default:[ \t]*"?cc\/claude-sonnet-4-6"?/m);
    expect(yaml).toMatch(/provider:[ \t]*"?custom"?/m);
    expect(yaml).toMatch(/base_url:[ \t]*"?http:\/\/localhost:20128\/v1"?/m);
    expect(mocks.writeFile).toHaveBeenLastCalledWith(
      "/home/test/.hermes/.env",
      `OPENAI_API_KEY=${apiKey}\n`,
    );
  });

  it("POST leaves the existing Hermes key untouched when no key is supplied", async () => {
    const response = await postBody({
      baseUrl: "http://localhost:20128",
      model: "cc/claude-sonnet-4-6",
    });

    expect(response.status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile.mock.calls[0][1]).toContain("api_key: ${OPENAI_API_KEY}");
  });

  it("rejects API keys that could inject another Hermes environment variable", async () => {
    const response = await postBody({
      baseUrl: "http://localhost:20128",
      apiKey: "sk_valid\nOTHER_SECRET=leaked",
      model: "cc/claude-sonnet-4-6",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "apiKey must not contain line breaks" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("escapes model and endpoint values without exposing the supplied API key", async () => {
    const apiKey = "sk_hidden";
    const response = await postBody({
      baseUrl: 'http://localhost:20128/\\"quoted',
      apiKey,
      model: 'provider/\\"quoted',
    });

    expect(response.status).toBe(200);
    const yaml = mocks.writeFile.mock.calls[0][1];
    expect(yaml).toContain('default: "provider/\\\\\\"quoted"');
    expect(yaml).toContain('base_url: "http://localhost:20128/\\\\\\"quoted/v1"');
    expect(yaml).not.toContain(apiKey);
  });

  it.each([
    ["baseUrl", "http://localhost:20128\napi_key: leaked", "cc/claude-sonnet-4-6", "baseUrl must not contain line breaks or tabs"],
    ["model", "http://localhost:20128", "cc/claude\napi_key: leaked", "model must not contain line breaks or tabs"],
  ])("rejects %s values that could inject YAML fields", async (_field, baseUrl, model, error) => {
    const response = await postBody({ baseUrl, model });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it.each([0, {}, []])("rejects non-string API keys", async (apiKey) => {
    const response = await postBody({
      baseUrl: "http://localhost:20128",
      apiKey,
      model: "cc/claude-sonnet-4-6",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "apiKey must be a non-empty string when provided" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });


  it("GET round-trips the api_key field through parseModelBlock", async () => {
    // Seed config with the YAML that POST would have written.
    mocks.readFile.mockImplementation(async (path) => {
      if (String(path).endsWith("config.yaml")) {
        return [
          'model:',
          '  default: "cc/claude-sonnet-4-6"',
          '  provider: "custom"',
          '  base_url: "http://localhost:20128/v1"',
          '  api_key: "${OPENAI_API_KEY}"',
          '',
        ].join("\n");
      }
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.installed).toBe(true);
    expect(body.settings.model).toEqual({
      default: "cc/claude-sonnet-4-6",
      provider: "custom",
      base_url: "http://localhost:20128/v1",
      api_key: "${OPENAI_API_KEY}",
    });
  });
});
