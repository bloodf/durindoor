// #2287 item 3: the crush, forge, smelt, codewhale and pi settings routes share one
// descriptor-driven handler (src/lib/cliTools/settingsRoute.js). The inline snapshots
// below were recorded against the per-route implementations before the port, so any
// drift in responses, written files, ownership refusals or formats fails here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseJsonc, stripJsoncTrailingCommas } from "@/lib/cliTools/jsonc.js";

let tmpHome;

const loadRoute = (name) => import(`@/app/api/cli-tools/${name}-settings/route.js`);
const norm = (value) => JSON.parse(JSON.stringify(value ?? null).split(tmpHome).join("<HOME>"));

async function listFiles(dir, base = dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return {};
  }
  const out = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await listFiles(full, base));
    else out[path.relative(base, full)] = await fs.readFile(full, "utf-8");
  }
  return out;
}

const seed = async (rel, content) => {
  const file = path.join(tmpHome, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};

const APPLY = { baseUrl: "http://localhost:20128", apiKey: "sk-test-secret", model: "cc/claude-sonnet-4-6" };

/** Run a GET/POST/DELETE sequence and record each response plus the resulting files. */
async function run(name, steps) {
  const route = await loadRoute(name);
  const log = [];
  for (const step of steps) {
    if (step.seed) {
      await seed(step.seed[0], step.seed[1]);
      continue;
    }
    let res;
    if (step.method === "POST") {
      const json = step.badJson ? async () => { throw new SyntaxError("bad"); } : async () => step.body;
      res = await route.POST({ json });
    } else {
      res = await route[step.method]();
    }
    log.push({
      step: step.label || step.method,
      status: res.status,
      body: norm(await res.json()),
      files: await listFiles(tmpHome),
    });
  }
  return log;
}

beforeEach(async () => {
  vi.resetModules();
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "arch-a2287t-"));
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
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.doUnmock("os");
  vi.doUnmock("child_process");
  vi.doUnmock("next/server");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const COMMON = [
  { method: "GET", label: "GET not installed" },
  { method: "DELETE", label: "DELETE no file" },
  { method: "POST", badJson: true, label: "POST invalid body" },
  { method: "POST", body: { model: "x" }, label: "POST no baseUrl" },
  { method: "POST", body: null, label: "POST null body" },
];

describe("crush-settings", () => {
  it("round trip", async () => {
    expect(await run("crush", [
      ...COMMON,
      { seed: [".config/crush/crush.json", JSON.stringify({ theme: "x", providers: { "9router": { base_url: "http://h/v1" }, other: { base_url: "https://o/v1" } } })] },
      { method: "GET", label: "GET legacy" },
      { method: "POST", body: APPLY },
      { method: "GET" },
      { method: "DELETE" },
      { method: "GET", label: "GET after reset" },
      { method: "POST", body: { baseUrl: "http://gw/v1" }, label: "POST defaults" },
      { method: "DELETE", label: "DELETE last provider" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": null,
            "installed": false,
            "message": "Crush CLI is not installed",
          },
          "files": {},
          "status": 200,
          "step": "GET not installed",
        },
        {
          "body": {
            "message": "No config file to reset",
            "success": true,
          },
          "files": {},
          "status": 200,
          "step": "DELETE no file",
        },
        {
          "body": {
            "error": "Invalid JSON body",
          },
          "files": {},
          "status": 400,
          "step": "POST invalid body",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST no baseUrl",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST null body",
        },
        {
          "body": {
            "config": {
              "providers": {
                "9router": {
                  "base_url": "http://h/v1",
                },
                "other": {
                  "base_url": "https://o/v1",
                },
              },
              "theme": "x",
            },
            "configPath": "<HOME>/.config/crush/crush.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".config/crush/crush.json": "{"theme":"x","providers":{"9router":{"base_url":"http://h/v1"},"other":{"base_url":"https://o/v1"}}}",
          },
          "status": 200,
          "step": "GET legacy",
        },
        {
          "body": {
            "configPath": "<HOME>/.config/crush/crush.json",
            "message": "Crush settings applied successfully!",
            "success": true,
          },
          "files": {
            ".config/crush/crush.json": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          },
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://localhost:20128/v1",
            "api_key": "sk-test-secret",
            "models": [
              {
                "id": "cc/claude-sonnet-4-6",
                "name": "cc/claude-sonnet-4-6",
                "context_window": 128000
              }
            ]
          }
        }
      }",
            ".config/crush/crush.json.bak": "{"theme":"x","providers":{"9router":{"base_url":"http://h/v1"},"other":{"base_url":"https://o/v1"}}}",
          },
          "status": 200,
          "step": "POST",
        },
        {
          "body": {
            "config": {
              "providers": {
                "durindoor": {
                  "api_key": "[REDACTED]",
                  "base_url": "http://localhost:20128/v1",
                  "models": [
                    {
                      "context_window": 128000,
                      "id": "cc/claude-sonnet-4-6",
                      "name": "cc/claude-sonnet-4-6",
                    },
                  ],
                  "type": "openai-compat",
                },
                "other": {
                  "base_url": "https://o/v1",
                },
              },
              "theme": "x",
            },
            "configPath": "<HOME>/.config/crush/crush.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".config/crush/crush.json": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          },
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://localhost:20128/v1",
            "api_key": "sk-test-secret",
            "models": [
              {
                "id": "cc/claude-sonnet-4-6",
                "name": "cc/claude-sonnet-4-6",
                "context_window": 128000
              }
            ]
          }
        }
      }",
            ".config/crush/crush.json.bak": "{"theme":"x","providers":{"9router":{"base_url":"http://h/v1"},"other":{"base_url":"https://o/v1"}}}",
          },
          "status": 200,
          "step": "GET",
        },
        {
          "body": {
            "message": "DurinDoor removed from Crush",
            "success": true,
          },
          "files": {
            ".config/crush/crush.json": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          }
        }
      }",
            ".config/crush/crush.json.bak": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          },
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://localhost:20128/v1",
            "api_key": "sk-test-secret",
            "models": [
              {
                "id": "cc/claude-sonnet-4-6",
                "name": "cc/claude-sonnet-4-6",
                "context_window": 128000
              }
            ]
          }
        }
      }",
          },
          "status": 200,
          "step": "DELETE",
        },
        {
          "body": {
            "config": {
              "providers": {
                "other": {
                  "base_url": "https://o/v1",
                },
              },
              "theme": "x",
            },
            "configPath": "<HOME>/.config/crush/crush.json",
            "has9Router": false,
            "installed": true,
          },
          "files": {
            ".config/crush/crush.json": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          }
        }
      }",
            ".config/crush/crush.json.bak": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          },
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://localhost:20128/v1",
            "api_key": "sk-test-secret",
            "models": [
              {
                "id": "cc/claude-sonnet-4-6",
                "name": "cc/claude-sonnet-4-6",
                "context_window": 128000
              }
            ]
          }
        }
      }",
          },
          "status": 200,
          "step": "GET after reset",
        },
        {
          "body": {
            "configPath": "<HOME>/.config/crush/crush.json",
            "message": "Crush settings applied successfully!",
            "success": true,
          },
          "files": {
            ".config/crush/crush.json": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          },
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://gw/v1",
            "api_key": "sk_durindoor",
            "models": [
              {
                "id": "provider/model-id",
                "name": "provider/model-id",
                "context_window": 128000
              }
            ]
          }
        }
      }",
            ".config/crush/crush.json.bak": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          }
        }
      }",
          },
          "status": 200,
          "step": "POST defaults",
        },
        {
          "body": {
            "message": "DurinDoor removed from Crush",
            "success": true,
          },
          "files": {
            ".config/crush/crush.json": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          }
        }
      }",
            ".config/crush/crush.json.bak": "{
        "theme": "x",
        "providers": {
          "other": {
            "base_url": "https://o/v1"
          },
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://gw/v1",
            "api_key": "sk_durindoor",
            "models": [
              {
                "id": "provider/model-id",
                "name": "provider/model-id",
                "context_window": 128000
              }
            ]
          }
        }
      }",
          },
          "status": 200,
          "step": "DELETE last provider",
        },
      ]
    `);
  });

  it("malformed and non-object files", async () => {
    expect(await run("crush", [
      { seed: [".config/crush/crush.json", "[1,2]"] },
      { method: "GET", label: "GET array" },
      { method: "POST", body: APPLY, label: "POST array" },
      { method: "DELETE", label: "DELETE array" },
      { seed: [".config/crush/crush.json", "{ nope"] },
      { method: "GET", label: "GET malformed" },
      { method: "POST", body: APPLY, label: "POST malformed" },
      { seed: [".config/crush/crush.json", JSON.stringify({ providers: "str" })] },
      { method: "DELETE", label: "DELETE non-object providers" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": [
              1,
              2,
            ],
            "configPath": "<HOME>/.config/crush/crush.json",
            "has9Router": false,
            "installed": true,
          },
          "files": {
            ".config/crush/crush.json": "[1,2]",
          },
          "status": 200,
          "step": "GET array",
        },
        {
          "body": {
            "error": "<HOME>/.config/crush/crush.json exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".config/crush/crush.json": "[1,2]",
          },
          "status": 500,
          "step": "POST array",
        },
        {
          "body": {
            "error": "<HOME>/.config/crush/crush.json exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".config/crush/crush.json": "[1,2]",
          },
          "status": 500,
          "step": "DELETE array",
        },
        {
          "body": {
            "config": null,
            "configPath": "<HOME>/.config/crush/crush.json",
            "has9Router": false,
            "installed": true,
          },
          "files": {
            ".config/crush/crush.json": "{ nope",
          },
          "status": 200,
          "step": "GET malformed",
        },
        {
          "body": {
            "error": "<HOME>/.config/crush/crush.json exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".config/crush/crush.json": "{ nope",
          },
          "status": 500,
          "step": "POST malformed",
        },
        {
          "body": {
            "message": "DurinDoor removed from Crush",
            "success": true,
          },
          "files": {
            ".config/crush/crush.json": "{"providers":"str"}",
          },
          "status": 200,
          "step": "DELETE non-object providers",
        },
      ]
    `);
  });

  it("honours XDG_CONFIG_HOME", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", path.join(tmpHome, "xdg"));
    expect(await run("crush", [{ method: "POST", body: APPLY }])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "configPath": "<HOME>/xdg/crush/crush.json",
            "message": "Crush settings applied successfully!",
            "success": true,
          },
          "files": {
            "xdg/crush/crush.json": "{
        "providers": {
          "durindoor": {
            "type": "openai-compat",
            "base_url": "http://localhost:20128/v1",
            "api_key": "sk-test-secret",
            "models": [
              {
                "id": "cc/claude-sonnet-4-6",
                "name": "cc/claude-sonnet-4-6",
                "context_window": 128000
              }
            ]
          }
        }
      }",
          },
          "status": 200,
          "step": "POST",
        },
      ]
    `);
  });
});

describe("forge-settings", () => {
  it("round trip", async () => {
    expect(await run("forge", [
      ...COMMON,
      { method: "POST", body: APPLY, label: "POST fresh" },
      { method: "GET" },
      { method: "DELETE", label: "DELETE only table" },
      { seed: [".forge/config.toml", `[ui]\ntheme = "dark"\n`] },
      { method: "POST", body: { baseUrl: "http://gw/v1" }, label: "POST defaults" },
      { method: "DELETE" },
      { method: "DELETE", label: "DELETE unmanaged" },
      { seed: [".forge/config.toml", `# managed by 9Router\n[openai]\nbase_url = "https://x/v1"\n`] },
      { method: "GET", label: "GET legacy header" },
      { method: "DELETE", label: "DELETE legacy header" },
      { seed: [".forge/config.toml", "model = = broken\n"] },
      { method: "GET", label: "GET malformed" },
      { method: "POST", body: APPLY, label: "POST malformed" },
      { method: "DELETE", label: "DELETE malformed" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": null,
            "installed": false,
            "message": "ForgeCode CLI is not installed",
          },
          "files": {},
          "status": 200,
          "step": "GET not installed",
        },
        {
          "body": {
            "message": "No config file to reset",
            "success": true,
          },
          "files": {},
          "status": 200,
          "step": "DELETE no file",
        },
        {
          "body": {
            "error": "Invalid JSON body",
          },
          "files": {},
          "status": 400,
          "step": "POST invalid body",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST no baseUrl",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST null body",
        },
        {
          "body": {
            "configPath": "<HOME>/.forge/config.toml",
            "message": "ForgeCode settings applied successfully!",
            "success": true,
          },
          "files": {
            ".forge/config.toml": "# ForgeCode config - managed by DurinDoor

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
          },
          "status": 200,
          "step": "POST fresh",
        },
        {
          "body": {
            "config": {
              "openai": {
                "api_key": "[REDACTED]",
                "base_url": "http://localhost:20128/v1",
                "model": "cc/claude-sonnet-4-6",
              },
            },
            "configPath": "<HOME>/.forge/config.toml",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".forge/config.toml": "# ForgeCode config - managed by DurinDoor

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
          },
          "status": 200,
          "step": "GET",
        },
        {
          "body": {
            "message": "DurinDoor removed from ForgeCode",
            "success": true,
          },
          "files": {},
          "status": 200,
          "step": "DELETE only table",
        },
        {
          "body": {
            "configPath": "<HOME>/.forge/config.toml",
            "message": "ForgeCode settings applied successfully!",
            "success": true,
          },
          "files": {
            ".forge/config.toml": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
            ".forge/config.toml.bak": "[ui]
      theme = "dark"
      ",
          },
          "status": 200,
          "step": "POST defaults",
        },
        {
          "body": {
            "message": "DurinDoor removed from ForgeCode",
            "success": true,
          },
          "files": {
            ".forge/config.toml": "[ui]
      theme = "dark"
      ",
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 200,
          "step": "DELETE",
        },
        {
          "body": {
            "message": "ForgeCode is not configured for DurinDoor",
            "success": true,
          },
          "files": {
            ".forge/config.toml": "[ui]
      theme = "dark"
      ",
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 200,
          "step": "DELETE unmanaged",
        },
        {
          "body": {
            "config": {
              "openai": {
                "base_url": "https://x/v1",
              },
            },
            "configPath": "<HOME>/.forge/config.toml",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".forge/config.toml": "# managed by 9Router
      [openai]
      base_url = "https://x/v1"
      ",
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 200,
          "step": "GET legacy header",
        },
        {
          "body": {
            "message": "DurinDoor removed from ForgeCode",
            "success": true,
          },
          "files": {
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 200,
          "step": "DELETE legacy header",
        },
        {
          "body": {
            "config": null,
            "configPath": "<HOME>/.forge/config.toml",
            "has9Router": false,
            "installed": true,
          },
          "files": {
            ".forge/config.toml": "model = = broken
      ",
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 200,
          "step": "GET malformed",
        },
        {
          "body": {
            "error": "<HOME>/.forge/config.toml exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".forge/config.toml": "model = = broken
      ",
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 500,
          "step": "POST malformed",
        },
        {
          "body": {
            "error": "<HOME>/.forge/config.toml exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".forge/config.toml": "model = = broken
      ",
            ".forge/config.toml.bak": "# ForgeCode config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk_durindoor"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
          },
          "status": 500,
          "step": "DELETE malformed",
        },
      ]
    `);
  });
});

describe("smelt-settings", () => {
  it("round trip", async () => {
    expect(await run("smelt", [
      ...COMMON,
      { seed: [".smelt/config.json", JSON.stringify({ theme: "dark", model: "old" })] },
      { method: "POST", body: { baseUrl: "http://localhost:20128/v1", apiKey: "k" } },
      { method: "GET" },
      { method: "DELETE" },
      { method: "DELETE", label: "DELETE unmanaged" },
      { seed: [".smelt/config.json", JSON.stringify({ baseUrl: "http://x/v1", _managedBy: "9router" })] },
      { method: "GET", label: "GET legacy marker" },
      { method: "DELETE", label: "DELETE legacy marker removes file" },
      { seed: [".smelt/config.json", "[]"] },
      { method: "GET", label: "GET array" },
      { method: "POST", body: APPLY, label: "POST array" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": null,
            "installed": false,
            "message": "Smelt is not installed",
          },
          "files": {},
          "status": 200,
          "step": "GET not installed",
        },
        {
          "body": {
            "message": "No config file to reset",
            "success": true,
          },
          "files": {},
          "status": 200,
          "step": "DELETE no file",
        },
        {
          "body": {
            "error": "Invalid JSON body",
          },
          "files": {},
          "status": 400,
          "step": "POST invalid body",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST no baseUrl",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST null body",
        },
        {
          "body": {
            "configPath": "<HOME>/.smelt/config.json",
            "message": "Smelt settings applied successfully!",
            "success": true,
          },
          "files": {
            ".smelt/config.json": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
            ".smelt/config.json.bak": "{"theme":"dark","model":"old"}",
          },
          "status": 200,
          "step": "POST",
        },
        {
          "body": {
            "config": {
              "_managedBy": "durindoor",
              "apiKey": "[REDACTED]",
              "baseUrl": "http://localhost:20128/v1",
              "model": "old",
              "theme": "dark",
            },
            "configPath": "<HOME>/.smelt/config.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".smelt/config.json": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
            ".smelt/config.json.bak": "{"theme":"dark","model":"old"}",
          },
          "status": 200,
          "step": "GET",
        },
        {
          "body": {
            "message": "DurinDoor removed from Smelt",
            "success": true,
          },
          "files": {
            ".smelt/config.json": "{
        "theme": "dark"
      }",
            ".smelt/config.json.bak": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
          },
          "status": 200,
          "step": "DELETE",
        },
        {
          "body": {
            "message": "Smelt is not configured for DurinDoor",
            "success": true,
          },
          "files": {
            ".smelt/config.json": "{
        "theme": "dark"
      }",
            ".smelt/config.json.bak": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
          },
          "status": 200,
          "step": "DELETE unmanaged",
        },
        {
          "body": {
            "config": {
              "_managedBy": "9router",
              "baseUrl": "http://x/v1",
            },
            "configPath": "<HOME>/.smelt/config.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".smelt/config.json": "{"baseUrl":"http://x/v1","_managedBy":"9router"}",
            ".smelt/config.json.bak": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
          },
          "status": 200,
          "step": "GET legacy marker",
        },
        {
          "body": {
            "message": "DurinDoor removed from Smelt",
            "success": true,
          },
          "files": {
            ".smelt/config.json.bak": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
          },
          "status": 200,
          "step": "DELETE legacy marker removes file",
        },
        {
          "body": {
            "config": [],
            "configPath": "<HOME>/.smelt/config.json",
            "has9Router": false,
            "installed": true,
          },
          "files": {
            ".smelt/config.json": "[]",
            ".smelt/config.json.bak": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
          },
          "status": 200,
          "step": "GET array",
        },
        {
          "body": {
            "error": "<HOME>/.smelt/config.json exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".smelt/config.json": "[]",
            ".smelt/config.json.bak": "{
        "theme": "dark",
        "model": "old",
        "baseUrl": "http://localhost:20128/v1",
        "apiKey": "k",
        "_managedBy": "durindoor"
      }",
          },
          "status": 500,
          "step": "POST array",
        },
      ]
    `);
  });
});

describe("codewhale-settings", () => {
  it("round trip", async () => {
    expect(await run("codewhale", [
      ...COMMON,
      { seed: [".codewhale/config.toml", `[ui]\ntheme = "dark"\n`] },
      { method: "POST", body: APPLY },
      { method: "GET" },
      { method: "DELETE" },
      { method: "DELETE", label: "DELETE unmanaged" },
      { seed: [".codewhale/config.toml", "x = = y\n"] },
      { method: "POST", body: APPLY, label: "POST malformed" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": null,
            "installed": false,
            "message": "CodeWhale is not installed",
          },
          "files": {},
          "status": 200,
          "step": "GET not installed",
        },
        {
          "body": {
            "message": "No config file to reset",
            "success": true,
          },
          "files": {},
          "status": 200,
          "step": "DELETE no file",
        },
        {
          "body": {
            "error": "Invalid JSON body",
          },
          "files": {},
          "status": 400,
          "step": "POST invalid body",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST no baseUrl",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST null body",
        },
        {
          "body": {
            "configPath": "<HOME>/.codewhale/config.toml",
            "message": "CodeWhale settings applied successfully!",
            "success": true,
          },
          "files": {
            ".codewhale/config.toml": "# CodeWhale config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
            ".codewhale/config.toml.bak": "[ui]
      theme = "dark"
      ",
          },
          "status": 200,
          "step": "POST",
        },
        {
          "body": {
            "config": {
              "openai": {
                "api_key": "[REDACTED]",
                "base_url": "http://localhost:20128/v1",
                "model": "cc/claude-sonnet-4-6",
              },
              "ui": {
                "theme": "dark",
              },
            },
            "configPath": "<HOME>/.codewhale/config.toml",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".codewhale/config.toml": "# CodeWhale config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
            ".codewhale/config.toml.bak": "[ui]
      theme = "dark"
      ",
          },
          "status": 200,
          "step": "GET",
        },
        {
          "body": {
            "message": "DurinDoor removed from CodeWhale",
            "success": true,
          },
          "files": {
            ".codewhale/config.toml": "[ui]
      theme = "dark"
      ",
            ".codewhale/config.toml.bak": "# CodeWhale config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
          },
          "status": 200,
          "step": "DELETE",
        },
        {
          "body": {
            "message": "CodeWhale is not configured for DurinDoor",
            "success": true,
          },
          "files": {
            ".codewhale/config.toml": "[ui]
      theme = "dark"
      ",
            ".codewhale/config.toml.bak": "# CodeWhale config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
          },
          "status": 200,
          "step": "DELETE unmanaged",
        },
        {
          "body": {
            "error": "<HOME>/.codewhale/config.toml exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".codewhale/config.toml": "x = = y
      ",
            ".codewhale/config.toml.bak": "# CodeWhale config - managed by DurinDoor

      [ui]
      theme = "dark"

      [openai]
      api_key = "sk-test-secret"
      base_url = "http://localhost:20128/v1"
      model = "cc/claude-sonnet-4-6"
      ",
          },
          "status": 500,
          "step": "POST malformed",
        },
      ]
    `);
  });

  it("legacy ~/.deepseek path and providers.openai table", async () => {
    expect(await run("codewhale", [
      { seed: [".deepseek/config.toml", `[providers.openai]\napi_key = "old-key"\nbase_url = "http://localhost:20128/v1"\nextra = 1\n\n[providers.other]\nbase_url = "https://o"\n`] },
      { method: "GET", label: "GET legacy" },
      { method: "DELETE", label: "DELETE legacy providers.openai" },
      { seed: [".deepseek/config.toml", `[providers.openai]\napi_key = "old-key"\nbase_url = "http://localhost:20128/v1"\n`] },
      { method: "POST", body: { baseUrl: "http://gw" }, label: "POST keeps legacy key" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": {
              "providers": {
                "openai": {
                  "api_key": "[REDACTED]",
                  "base_url": "http://localhost:20128/v1",
                  "extra": 1,
                },
                "other": {
                  "base_url": "https://o",
                },
              },
            },
            "configPath": "<HOME>/.deepseek/config.toml",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".deepseek/config.toml": "[providers.openai]
      api_key = "old-key"
      base_url = "http://localhost:20128/v1"
      extra = 1

      [providers.other]
      base_url = "https://o"
      ",
          },
          "status": 200,
          "step": "GET legacy",
        },
        {
          "body": {
            "message": "DurinDoor removed from CodeWhale",
            "success": true,
          },
          "files": {
            ".deepseek/config.toml": "[providers.other]
      base_url = "https://o"
      ",
            ".deepseek/config.toml.bak": "[providers.openai]
      api_key = "old-key"
      base_url = "http://localhost:20128/v1"
      extra = 1

      [providers.other]
      base_url = "https://o"
      ",
          },
          "status": 200,
          "step": "DELETE legacy providers.openai",
        },
        {
          "body": {
            "configPath": "<HOME>/.deepseek/config.toml",
            "message": "CodeWhale settings applied successfully!",
            "success": true,
          },
          "files": {
            ".deepseek/config.toml": "# CodeWhale config - managed by DurinDoor

      [openai]
      api_key = "old-key"
      base_url = "http://gw/v1"
      model = "provider/model-id"
      ",
            ".deepseek/config.toml.bak": "[providers.openai]
      api_key = "old-key"
      base_url = "http://localhost:20128/v1"
      ",
          },
          "status": 200,
          "step": "POST keeps legacy key",
        },
      ]
    `);
  });
});

describe("pi-settings", () => {
  it("round trip", async () => {
    expect(await run("pi", [
      ...COMMON,
      { seed: [".pi/agent/models.json", JSON.stringify({ providers: { other: { baseUrl: "https://x/v1" }, "9router": { baseUrl: "http://g/v1", apiKey: "legacy-key", models: [{ id: "a/b", contextWindow: 5, maxTokens: 6 }] } } })] },
      { method: "GET", label: "GET legacy" },
      { method: "POST", body: { baseUrl: "http://localhost:20128", apiKey: "sk_durindoor", models: ["a/b", { id: "c/d", contextWindow: 7, maxTokens: 999 }] } },
      { method: "GET" },
      { method: "DELETE" },
      { method: "DELETE", label: "DELETE again" },
      { seed: [".pi/agent/models.json", "{ nope"] },
      { method: "POST", body: APPLY, label: "POST malformed" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": null,
            "installed": false,
            "message": "Pi CLI is not installed",
          },
          "files": {},
          "status": 200,
          "step": "GET not installed",
        },
        {
          "body": {
            "message": "No config file to reset",
            "success": true,
          },
          "files": {},
          "status": 200,
          "step": "DELETE no file",
        },
        {
          "body": {
            "error": "Invalid JSON body",
          },
          "files": {},
          "status": 400,
          "step": "POST invalid body",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST no baseUrl",
        },
        {
          "body": {
            "error": "baseUrl is required",
          },
          "files": {},
          "status": 400,
          "step": "POST null body",
        },
        {
          "body": {
            "config": {
              "providers": {
                "9router": {
                  "apiKey": "[REDACTED]",
                  "baseUrl": "http://g/v1",
                  "models": [
                    {
                      "contextWindow": 5,
                      "id": "a/b",
                      "maxTokens": 6,
                    },
                  ],
                },
                "other": {
                  "baseUrl": "https://x/v1",
                },
              },
            },
            "configPath": "<HOME>/.pi/agent/models.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".pi/agent/models.json": "{"providers":{"other":{"baseUrl":"https://x/v1"},"9router":{"baseUrl":"http://g/v1","apiKey":"legacy-key","models":[{"id":"a/b","contextWindow":5,"maxTokens":6}]}}}",
          },
          "status": 200,
          "step": "GET legacy",
        },
        {
          "body": {
            "configPath": "<HOME>/.pi/agent/models.json",
            "message": "Pi settings applied! Use /model in Pi to select a DurinDoor model.",
            "success": true,
          },
          "files": {
            ".pi/agent/models.json": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          },
          "durindoor": {
            "baseUrl": "http://localhost:20128/v1",
            "apiKey": "legacy-key",
            "models": [
              {
                "id": "a/b",
                "contextWindow": 5,
                "maxTokens": 6,
                "name": "a/b"
              },
              {
                "id": "c/d",
                "contextWindow": 7,
                "maxTokens": 999,
                "name": "c/d",
                "input": [
                  "text"
                ],
                "reasoning": false
              }
            ],
            "api": "openai-completions"
          }
        }
      }",
            ".pi/agent/models.json.bak": "{"providers":{"other":{"baseUrl":"https://x/v1"},"9router":{"baseUrl":"http://g/v1","apiKey":"legacy-key","models":[{"id":"a/b","contextWindow":5,"maxTokens":6}]}}}",
          },
          "status": 200,
          "step": "POST",
        },
        {
          "body": {
            "config": {
              "providers": {
                "durindoor": {
                  "api": "openai-completions",
                  "apiKey": "[REDACTED]",
                  "baseUrl": "http://localhost:20128/v1",
                  "models": [
                    {
                      "contextWindow": 5,
                      "id": "a/b",
                      "maxTokens": 6,
                      "name": "a/b",
                    },
                    {
                      "contextWindow": 7,
                      "id": "c/d",
                      "input": [
                        "text",
                      ],
                      "maxTokens": 999,
                      "name": "c/d",
                      "reasoning": false,
                    },
                  ],
                },
                "other": {
                  "baseUrl": "https://x/v1",
                },
              },
            },
            "configPath": "<HOME>/.pi/agent/models.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".pi/agent/models.json": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          },
          "durindoor": {
            "baseUrl": "http://localhost:20128/v1",
            "apiKey": "legacy-key",
            "models": [
              {
                "id": "a/b",
                "contextWindow": 5,
                "maxTokens": 6,
                "name": "a/b"
              },
              {
                "id": "c/d",
                "contextWindow": 7,
                "maxTokens": 999,
                "name": "c/d",
                "input": [
                  "text"
                ],
                "reasoning": false
              }
            ],
            "api": "openai-completions"
          }
        }
      }",
            ".pi/agent/models.json.bak": "{"providers":{"other":{"baseUrl":"https://x/v1"},"9router":{"baseUrl":"http://g/v1","apiKey":"legacy-key","models":[{"id":"a/b","contextWindow":5,"maxTokens":6}]}}}",
          },
          "status": 200,
          "step": "GET",
        },
        {
          "body": {
            "message": "DurinDoor removed from Pi",
            "success": true,
          },
          "files": {
            ".pi/agent/models.json": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          }
        }
      }",
            ".pi/agent/models.json.bak": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          },
          "durindoor": {
            "baseUrl": "http://localhost:20128/v1",
            "apiKey": "legacy-key",
            "models": [
              {
                "id": "a/b",
                "contextWindow": 5,
                "maxTokens": 6,
                "name": "a/b"
              },
              {
                "id": "c/d",
                "contextWindow": 7,
                "maxTokens": 999,
                "name": "c/d",
                "input": [
                  "text"
                ],
                "reasoning": false
              }
            ],
            "api": "openai-completions"
          }
        }
      }",
          },
          "status": 200,
          "step": "DELETE",
        },
        {
          "body": {
            "message": "DurinDoor removed from Pi",
            "success": true,
          },
          "files": {
            ".pi/agent/models.json": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          }
        }
      }",
            ".pi/agent/models.json.bak": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          }
        }
      }",
          },
          "status": 200,
          "step": "DELETE again",
        },
        {
          "body": {
            "error": "<HOME>/.pi/agent/models.json exists but could not be parsed; refusing to overwrite it",
          },
          "files": {
            ".pi/agent/models.json": "{ nope",
            ".pi/agent/models.json.bak": "{
        "providers": {
          "other": {
            "baseUrl": "https://x/v1"
          }
        }
      }",
          },
          "status": 500,
          "step": "POST malformed",
        },
      ]
    `);
  });

  it("falls back to ~/.pi/models.json", async () => {
    expect(await run("pi", [
      { seed: [".pi/models.json", JSON.stringify({ providers: { durindoor: { baseUrl: "http://x/v1", models: [] } } })] },
      { method: "GET" },
      { method: "DELETE" },
    ])).toMatchInlineSnapshot(`
      [
        {
          "body": {
            "config": {
              "providers": {
                "durindoor": {
                  "baseUrl": "http://x/v1",
                  "models": [],
                },
              },
            },
            "configPath": "<HOME>/.pi/models.json",
            "has9Router": true,
            "installed": true,
          },
          "files": {
            ".pi/models.json": "{"providers":{"durindoor":{"baseUrl":"http://x/v1","models":[]}}}",
          },
          "status": 200,
          "step": "GET",
        },
        {
          "body": {
            "message": "DurinDoor removed from Pi",
            "success": true,
          },
          "files": {
            ".pi/models.json": "{}",
            ".pi/models.json.bak": "{"providers":{"durindoor":{"baseUrl":"http://x/v1","models":[]}}}",
          },
          "status": 200,
          "step": "DELETE",
        },
      ]
    `);
  });
});

describe("foreign owner refusal (CLI_CONFIG_FOREIGN_OWNER)", () => {
  it.each([
    ["crush", ".config/crush/crush.json", JSON.stringify({ providers: { other: {} } })],
    ["forge", ".forge/config.toml", `# managed by DurinDoor\n[openai]\nbase_url = "x"\n[ui]\na = 1\n`],
    ["smelt", ".smelt/config.json", JSON.stringify({ _managedBy: "durindoor", theme: "d" })],
    ["codewhale", ".codewhale/config.toml", `# managed by DurinDoor\n[openai]\nbase_url = "x"\n[ui]\na = 1\n`],
    ["pi", ".pi/agent/models.json", JSON.stringify({ providers: { durindoor: { baseUrl: "x" } } })],
  ])("%s refuses POST and DELETE over a file owned by another uid", async (name, rel, content) => {
    await seed(rel, content);
    const realUid = process.geteuid();
    vi.spyOn(process, "geteuid").mockReturnValue(realUid + 4242);
    const route = await loadRoute(name);
    const post = await route.POST({ json: async () => APPLY });
    const del = await route.DELETE();
    const postBody = norm(await post.json());
    const delBody = norm(await del.json());
    expect(post.status).toBe(500);
    expect(del.status).toBe(500);
    expect(postBody.error).toBe(`Refusing to replace CLI config owned by uid ${realUid} from uid ${realUid + 4242}: <HOME>/${rel}`);
    expect(delBody.error).toBe(postBody.error);
    expect(await fs.readFile(path.join(tmpHome, rel), "utf-8")).toBe(content);
  });
});

describe("jsonc", () => {
  it("strips trailing commas the way the route copies did", () => {
    expect(stripJsoncTrailingCommas(`{"a": [1, 2,], "b": {"c": 1,\n},}`)).toBe(`{"a": [1, 2], "b": {"c": 1\n}}`);
    expect(parseJsonc(`{"a": [1, 2,],}`)).toEqual({ a: [1, 2] });
  });

  it("leaves commas inside strings alone", () => {
    expect(parseJsonc(`{"a": "x,}", "b": "y\\",]",}`)).toEqual({ a: "x,}", b: "y\",]" });
  });

  it("throws on invalid input", () => {
    expect(() => parseJsonc("{ nope")).toThrow();
  });
});
