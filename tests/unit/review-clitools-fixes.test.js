import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseTOML } from "confbox";
import { parse as parseJsonc } from "jsonc-parser";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const droid = await import("@/app/api/cli-tools/droid-settings/route.js");
const codex = await import("@/app/api/cli-tools/codex-settings/route.js");
const claude = await import("@/app/api/cli-tools/claude-settings/route.js");

let tempHome;
let prevHome;

beforeEach(() => {
  prevHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-clitools-review-"));
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function makePostRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("#2187 Droid settings JSONC safety and default model ordering", () => {
  it("preserves JSONC comments, trailing commas, other keys, and user customModels on POST and GET", async () => {
    const settingsPath = path.join(tempHome, ".factory", "settings.json");
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    const initialJsonc = [
      "{",
      "  // keep this comment",
      '  "theme": "dark",',
      '  "customModels": [',
      "    {",
      '      "model": "user-model",',
      '      "id": "custom:User-0",',
      '      "index": 0,',
      "    },",
      "  ],",
      "}",
      "",
    ].join("\n");
    await fsp.writeFile(settingsPath, initialJsonc);

    const postRes = await droid.POST(
      makePostRequest("http://localhost/api/cli-tools/droid-settings", {
        baseUrl: "http://localhost:20128",
        apiKey: "sk-dd",
        models: ["a", "b"],
        activeModel: "a",
      })
    );
    expect(postRes.status).toBe(200);

    const updatedRaw = await fsp.readFile(settingsPath, "utf8");
    expect(updatedRaw).toContain("// keep this comment");

    const errors = [];
    const updated = parseJsonc(updatedRaw, errors, { allowTrailingComma: true, disallowComments: false });
    expect(errors).toHaveLength(0);
    expect(updated.theme).toBe("dark");
    expect(updated.customModels.map((m) => m.model)).toEqual(["a", "user-model", "b"]);

    const getRes = await droid.GET();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.installed).toBe(true);
    expect(getBody.has9Router).toBe(true);
    expect(getBody.settings.theme).toBe("dark");
    expect(getBody.settings.customModels.map((m) => m.model)).toEqual(["a", "user-model", "b"]);
  });

  it.each([
    ["malformed JSONC", '{ // broken\n "customModels": ['],
    ["non-object JSON", '["a", "b"]'],
  ])("refuses %s on POST and DELETE without modifying settings.json", async (_label, brokenContent) => {
    const settingsPath = path.join(tempHome, ".factory", "settings.json");
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(settingsPath, brokenContent);

    const postRes = await droid.POST(
      makePostRequest("http://localhost/api/cli-tools/droid-settings", {
        baseUrl: "http://localhost:20128",
        apiKey: "sk-dd",
        models: ["a"],
      })
    );
    expect(postRes.status).toBe(500);
    expect((await postRes.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(settingsPath, "utf8")).toBe(brokenContent);

    const deleteRes = await droid.DELETE();
    expect(deleteRes.status).toBe(500);
    expect((await deleteRes.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(settingsPath, "utf8")).toBe(brokenContent);
  });

  it("picks activeModel by DurinDoor entry id when user customModels are present", async () => {
    const settingsPath = path.join(tempHome, ".factory", "settings.json");
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(
      settingsPath,
      JSON.stringify({
        customModels: [{ model: "U", id: "custom:User-0", index: 0 }],
      })
    );

    const res = await droid.POST(
      makePostRequest("http://localhost/api/cli-tools/droid-settings", {
        baseUrl: "http://localhost:20128",
        apiKey: "sk-dd",
        models: ["a", "b"],
        activeModel: "b",
      })
    );
    expect(res.status).toBe(200);

    const saved = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
    expect(saved.customModels.map((m) => m.model)).toEqual(["b", "U", "a"]);
    expect(saved.customModels.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it("keeps user model first when activeModel is empty string and removes only DurinDoor entries on DELETE", async () => {
    const settingsPath = path.join(tempHome, ".factory", "settings.json");
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(
      settingsPath,
      "{\n  // user note\n  \"customModels\": [{ \"model\": \"U\", \"id\": \"custom:User-0\", \"index\": 0 }]\n}\n"
    );

    const postRes = await droid.POST(
      makePostRequest("http://localhost/api/cli-tools/droid-settings", {
        baseUrl: "http://localhost:20128",
        apiKey: "sk-dd",
        models: ["a", "b"],
        activeModel: "",
      })
    );
    expect(postRes.status).toBe(200);
    const afterPost = parseJsonc(await fsp.readFile(settingsPath, "utf8"));
    expect(afterPost.customModels.map((m) => m.model)).toEqual(["U", "a", "b"]);

    const delRes = await droid.DELETE();
    expect(delRes.status).toBe(200);
    const afterDeleteRaw = await fsp.readFile(settingsPath, "utf8");
    expect(afterDeleteRaw).toContain("// user note");
    const afterDelete = parseJsonc(afterDeleteRaw);
    expect(afterDelete.customModels).toEqual([{ model: "U", id: "custom:User-0", index: 0 }]);
  });
});

describe("#2188 and #2189 Codex backup/restore, ownership, base_url, and empty tables", () => {
  it("backs up user-owned values on save and restores them on reset even after repeated saves", async () => {
    const codexDir = path.join(tempHome, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    await fsp.mkdir(codexDir, { recursive: true });

    await fsp.writeFile(
      configPath,
      [
        'model = "o3"',
        'model_provider = "openai"',
        "",
        "[agents.subagent]",
        'model = "gpt-4o-mini"',
        'sandbox_mode = "read-only"',
        "",
      ].join("\n")
    );
    await fsp.writeFile(
      authPath,
      JSON.stringify({
        OPENAI_API_KEY: "sk-user-owned",
        auth_mode: "chatgpt",
        tokens: { access: "keep-token" },
      })
    );

    const firstSave = await codex.POST(
      makePostRequest("http://localhost/api/cli-tools/codex-settings", {
        baseUrl: "http://h:20128/",
        apiKey: "sk-dd-1",
        model: "dd-model-1",
        subagentModel: "dd-sub-1",
      })
    );
    expect(firstSave.status).toBe(200);

    const secondSave = await codex.POST(
      makePostRequest("http://localhost/api/cli-tools/codex-settings", {
        baseUrl: "http://h:20128/v1/",
        apiKey: "sk-dd-2",
        model: "dd-model-2",
        subagentModel: "dd-sub-2",
      })
    );
    expect(secondSave.status).toBe(200);

    const appliedConfig = parseTOML(await fsp.readFile(configPath, "utf8"));
    expect(appliedConfig.model).toBe("dd-model-2");
    expect(appliedConfig.model_provider).toBe("9router");
    expect(appliedConfig.model_providers["9router"].base_url).toBe("http://h:20128/v1");
    expect(appliedConfig.agents.subagent).toEqual({
      model: "dd-sub-2",
      sandbox_mode: "read-only",
    });

    const appliedAuth = JSON.parse(await fsp.readFile(authPath, "utf8"));
    expect(appliedAuth).toEqual({
      OPENAI_API_KEY: "sk-dd-2",
      auth_mode: "apikey",
      tokens: { access: "keep-token" },
    });

    const resetRes = await codex.DELETE();
    expect(resetRes.status).toBe(200);

    const restoredConfig = parseTOML(await fsp.readFile(configPath, "utf8"));
    expect(restoredConfig.model).toBe("o3");
    expect(restoredConfig.model_provider).toBe("openai");
    expect(restoredConfig.model_providers).toBeUndefined();
    expect(restoredConfig.agents.subagent).toEqual({
      model: "gpt-4o-mini",
      sandbox_mode: "read-only",
    });

    const restoredAuth = JSON.parse(await fsp.readFile(authPath, "utf8"));
    expect(restoredAuth).toEqual({
      OPENAI_API_KEY: "sk-user-owned",
      auth_mode: "chatgpt",
      tokens: { access: "keep-token" },
    });
  });

  it("removes DurinDoor keys, empty [agents]/[model_providers] tables, and empty auth.json on fresh install reset", async () => {
    const codexDir = path.join(tempHome, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");

    const postRes = await codex.POST(
      makePostRequest("http://localhost/api/cli-tools/codex-settings", {
        baseUrl: "http://h:20128/",
        apiKey: "sk-dd",
        model: "dd-model",
      })
    );
    expect(postRes.status).toBe(200);

    const rawApplied = await fsp.readFile(configPath, "utf8");
    expect(rawApplied).toContain('base_url = "http://h:20128/v1"');
    expect(rawApplied).not.toContain("//v1");

    const delRes = await codex.DELETE();
    expect(delRes.status).toBe(200);

    const rawAfterReset = await fsp.readFile(configPath, "utf8");
    expect(rawAfterReset).not.toContain("[agents]");
    expect(rawAfterReset).not.toContain("[model_providers]");
    expect(parseTOML(rawAfterReset)).toEqual({});
    expect(fs.existsSync(authPath)).toBe(false);
  });

  it("does not delete user-owned subagent or auth.json when DurinDoor does not own them", async () => {
    const codexDir = path.join(tempHome, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    const authPath = path.join(codexDir, "auth.json");
    await fsp.mkdir(codexDir, { recursive: true });

    await fsp.writeFile(
      configPath,
      ['model = "o3"', 'model_provider = "openai"', "", "[agents.subagent]", 'model = "gpt-4o-mini"', ""].join("\n")
    );
    await fsp.writeFile(
      authPath,
      JSON.stringify({ OPENAI_API_KEY: "sk-user-only", auth_mode: "apikey" })
    );

    const delRes = await codex.DELETE();
    expect(delRes.status).toBe(200);

    const configAfter = parseTOML(await fsp.readFile(configPath, "utf8"));
    expect(configAfter.model).toBe("o3");
    expect(configAfter.model_provider).toBe("openai");
    expect(configAfter.agents.subagent.model).toBe("gpt-4o-mini");

    const authAfter = JSON.parse(await fsp.readFile(authPath, "utf8"));
    expect(authAfter).toEqual({ OPENAI_API_KEY: "sk-user-only", auth_mode: "apikey" });
  });
});

describe("#2189 Claude reset removes all keys POST writes and normalizes base URL", () => {
  it("removes ANTHROPIC_DEFAULT_FABLE_MODEL and all other POST env keys on DELETE", async () => {
    const settingsPath = path.join(tempHome, ".claude", "settings.json");

    const postRes = await claude.POST(
      makePostRequest("http://localhost/api/cli-tools/claude-settings", {
        env: {
          ANTHROPIC_BASE_URL: "http://h:20128/",
          ANTHROPIC_AUTH_TOKEN: "sk-dd",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-5-5",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-5",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc/claude-haiku-4-5-20251001",
          ANTHROPIC_DEFAULT_FABLE_MODEL: "cc/claude-fable-5-1",
          API_TIMEOUT_MS: "600000",
        },
        maxContextTokens: "198000",
      })
    );
    expect(postRes.status).toBe(200);

    const afterPost = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
    expect(afterPost.env.ANTHROPIC_BASE_URL).toBe("http://h:20128/v1");
    expect(afterPost.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-1");

    const delRes = await claude.DELETE();
    expect(delRes.status).toBe(200);

    const afterDelete = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
    expect(afterDelete.env).toBeUndefined();
  });

  it("refuses unparseable Claude settings.json on POST and DELETE without overwriting", async () => {
    const settingsPath = path.join(tempHome, ".claude", "settings.json");
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    const broken = "{ invalid json";
    await fsp.writeFile(settingsPath, broken);

    const postRes = await claude.POST(
      makePostRequest("http://localhost/api/cli-tools/claude-settings", {
        env: { ANTHROPIC_BASE_URL: "http://h:20128" },
      })
    );
    expect(postRes.status).toBe(500);
    expect((await postRes.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(settingsPath, "utf8")).toBe(broken);

    const delRes = await claude.DELETE();
    expect(delRes.status).toBe(500);
    expect((await delRes.json()).error).toContain("refusing to overwrite it");
    expect(await fsp.readFile(settingsPath, "utf8")).toBe(broken);
  });
});
