// Port of decolua/9router #4406: write a DurinDoor model catalog when applying Codex settings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseTOML } from "confbox";

const mocks = vi.hoisted(() => ({
  homedir: vi.fn(),
  platform: vi.fn(() => "linux"),
  loadBundledCodexCatalog: vi.fn(),
  buildModelsList: vi.fn(),
}));

vi.mock("os", () => ({
  default: { homedir: mocks.homedir, platform: mocks.platform },
  homedir: mocks.homedir,
  platform: mocks.platform,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

vi.mock("@/lib/cliTools/codexModelCatalog", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBundledCodexCatalog: mocks.loadBundledCodexCatalog,
  };
});

vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({
  buildModelsList: mocks.buildModelsList,
}));

import { buildCodexModelCatalog } from "../../src/lib/cliTools/codexModelCatalog.js";
const codexRoute = await import("@/app/api/cli-tools/codex-settings/route.js");

const entry = (slug, overrides = {}) => ({
  slug,
  display_name: slug.toUpperCase(),
  description: `${slug} description`,
  supported_reasoning_levels: [{ effort: "medium", description: "Balanced" }],
  support_verbosity: true,
  shell_type: "unified_exec",
  truncation_policy: { mode: "tokens", limit: 10000 },
  priority: 1,
  visibility: "list",
  supported_in_api: true,
  experimental_supported_tools: [],
  base_instructions: `instructions for ${slug}`,
  model_messages: { instructions_template: `template for ${slug}` },
  service_tiers: [{ id: "priority", name: "Fast" }],
  additional_speed_tiers: ["fast"],
  availability_nux: null,
  upgrade: null,
  context_window: 272000,
  max_context_window: 872000,
  tool_mode: null,
  use_responses_lite: false,
  multi_agent_version: null,
  multi_agent_reasoning_effort: null,
  ...overrides,
});

const codeMode = {
  tool_mode: "code_mode_only",
  use_responses_lite: true,
  multi_agent_version: "v2",
};

const bundled = {
  models: [
    entry("gpt-hidden-first", { priority: 0, visibility: "hide", ...codeMode }),
    entry("gpt-6-astra", {
      priority: 1,
      ...codeMode,
      multi_agent_reasoning_effort: "xhigh",
      experimental_supported_tools: ["send_user_message_async", "clock"],
    }),
    entry("gpt-5.6-terra", { priority: 2, ...codeMode }),
    entry("gpt-5.5", { priority: 10 }),
    entry("gpt-5.4", {
      priority: 16,
      visibility: "hide",
      upgrade: { model: "gpt-5.6-terra", migration_markdown: "retired" },
    }),
  ],
};

const listed = (catalog) => catalog.models.filter((m) => m.visibility === "list");
const bySlug = (catalog, slug) => catalog.models.find((m) => m.slug === slug);

describe("buildCodexModelCatalog (#4406)", () => {
  it("clones matched bundled entries by suffix and brands descriptions for DurinDoor", () => {
    const catalog = buildCodexModelCatalog(bundled, ["openai/gpt-5.6-terra", "cx/gpt-6-astra"]);
    const terra = bySlug(catalog, "openai/gpt-5.6-terra");
    expect(terra.base_instructions).toBe("instructions for gpt-5.6-terra");
    expect(terra.description).toBe("openai/gpt-5.6-terra via DurinDoor");
    expect(terra.visibility).toBe("list");
    expect(terra.priority).toBe(1);
    // Non-Codex prefix neutralizes code-mode flags
    expect(terra).toMatchObject({
      tool_mode: null,
      use_responses_lite: false,
      multi_agent_version: null,
      multi_agent_reasoning_effort: null,
      experimental_supported_tools: [],
    });

    // Codex prefix (cx/) preserves Codex-only code-mode fields
    const astra = bySlug(catalog, "cx/gpt-6-astra");
    expect(astra).toMatchObject({
      ...codeMode,
      multi_agent_reasoning_effort: "xhigh",
      experimental_supported_tools: ["send_user_message_async", "clock"],
    });
  });

  it("falls back to gpt-5.5 for unknown models, clears service tiers, and applies context_length", () => {
    const catalog = buildCodexModelCatalog(bundled, [
      { id: "cc/claude-opus-4-6", context_length: 200000 },
      { id: "cx/gpt-5.6-terra", context_length: 128000 },
    ]);
    const claude = bySlug(catalog, "cc/claude-opus-4-6");
    expect(claude.base_instructions).toBe("instructions for gpt-5.5");
    expect(claude.description).toContain("via DurinDoor (Codex profile: gpt-5.5)");
    expect(claude.service_tiers).toEqual([]);
    expect(claude.additional_speed_tiers).toEqual([]);
    expect(claude.context_window).toBe(200000);
    expect(claude.max_context_window).toBe(200000);

    // Matched template keeps its own bundled window
    const terra = bySlug(catalog, "cx/gpt-5.6-terra");
    expect(terra.context_window).toBe(272000);
    expect(terra.max_context_window).toBe(872000);
  });

  it("clears upgrade prompts on cloned entries while keeping hidden bundled originals intact", () => {
    const catalog = buildCodexModelCatalog(bundled, ["openai/gpt-5.4"]);
    expect(bySlug(catalog, "openai/gpt-5.4").upgrade).toBeNull();
    expect(bySlug(catalog, "gpt-5.4")).toMatchObject({
      visibility: "hide",
      upgrade: { model: "gpt-5.6-terra" },
    });
    expect(listed(catalog).map((m) => m.slug)).toEqual(["openai/gpt-5.4"]);
  });

  it("returns an empty catalog when no usable template exists", () => {
    expect(buildCodexModelCatalog({ models: [] }, ["cx/gpt-5.6-terra"])).toEqual({ models: [] });
    expect(buildCodexModelCatalog(null, ["cx/gpt-5.6-terra"])).toEqual({ models: [] });
  });
});

describe("codex-settings route catalog lifecycle (#4406)", () => {
  let home;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(process.cwd(), ".tmp-codex-catalog-"));
    mocks.homedir.mockReturnValue(home);
    mocks.loadBundledCodexCatalog.mockReset();
    mocks.buildModelsList.mockReset();
  });

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it("writes durindoor-models.json, sets model_catalog_json, and restores user catalog on DELETE", async () => {
    const codexDir = path.join(home, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    await fsp.mkdir(codexDir, { recursive: true });
    await fsp.writeFile(
      configPath,
      'model = "user-model"\nmodel_provider = "openai"\nmodel_catalog_json = "/custom/user-catalog.json"\n',
    );

    mocks.loadBundledCodexCatalog.mockResolvedValue(bundled);
    mocks.buildModelsList.mockResolvedValue([
      { id: "cc/claude-sonnet-4-6", context_length: 200000 },
    ]);

    const postRes = await codexRoute.POST(
      new Request("http://localhost/api/cli-tools/codex-settings", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "http://localhost:20128",
          apiKey: "sk-test",
          model: "cx/gpt-5.6-terra",
          subagentModel: "cc/claude-sonnet-4-6",
        }),
      }),
    );

    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    const expectedCatalogPath = path.join(codexDir, "durindoor-models.json");
    expect(postJson.catalogPath).toBe(expectedCatalogPath);
    expect(postJson.catalogModelCount).toBe(2);

    const writtenConfig = parseTOML(await fsp.readFile(configPath, "utf8"));
    expect(writtenConfig.model_catalog_json).toBe(expectedCatalogPath);

    const writtenCatalog = JSON.parse(await fsp.readFile(expectedCatalogPath, "utf8"));
    expect(listed(writtenCatalog).map((m) => m.slug)).toEqual([
      "cc/claude-sonnet-4-6",
      "cx/gpt-5.6-terra",
    ]);

    const delRes = await codexRoute.DELETE();
    expect(delRes.status).toBe(200);

    const restoredConfig = parseTOML(await fsp.readFile(configPath, "utf8"));
    expect(restoredConfig.model_catalog_json).toBe("/custom/user-catalog.json");
    expect(fs.existsSync(expectedCatalogPath)).toBe(false);
  });

  it("fails open with catalogWarning when codex bundled catalog is unavailable", async () => {
    mocks.loadBundledCodexCatalog.mockRejectedValue(new Error("codex not found"));

    const postRes = await codexRoute.POST(
      new Request("http://localhost/api/cli-tools/codex-settings", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "http://localhost:20128",
          apiKey: "sk-test",
          model: "cx/gpt-5.6-terra",
        }),
      }),
    );

    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.catalogWarning).toContain("bundled model catalog");
    const writtenConfig = parseTOML(await fsp.readFile(path.join(home, ".codex", "config.toml"), "utf8"));
    expect(writtenConfig.model_catalog_json).toBeUndefined();
  });
});
