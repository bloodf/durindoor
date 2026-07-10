import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAudit,
  classifyProvider,
  renderMarkdown,
  verifyCleanSourceCheckout,
  verifySourceCommit,
} from "../../scripts/audit-omniroute-providers.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runFixtureGit(cwd, args) {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) delete env[key];
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
}

function hostRepositoryState() {
  const run = (args) => spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  return {
    head: run(["rev-parse", "HEAD"]).stdout.trim(),
    topLevel: run(["rev-parse", "--show-toplevel"]).stdout.trim(),
    coreWorktree: run(["config", "--get", "core.worktree"]).stdout.trim(),
  };
}

function makeFixture() {
  const root = join(tmpdir(), `durindoor-audit-${process.pid}-${Date.now()}`);
  const durin = join(root, "durin");
  const omni = join(root, "omni");
  mkdirSync(join(durin, "open-sse/providers/registry"), { recursive: true });
  mkdirSync(join(durin, "public/providers"), { recursive: true });
  mkdirSync(join(omni, "open-sse/config/providers/registry"), { recursive: true });
  mkdirSync(join(omni, "public/providers"), { recursive: true });

  writeFileSync(join(durin, "open-sse/providers/registry/index.js"), `
    import p0 from "./present.js";
    import p1 from "./loose-file.js";
    export default [p0];
  `);
  writeFileSync(join(durin, "open-sse/providers/registry/present.js"), "export default { id: 'present' };\n");
  writeFileSync(join(durin, "open-sse/providers/registry/loose-file.js"), "export default { id: 'loose-file' };\n");
  writeFileSync(join(durin, "public/providers/present.png"), "");
  writeFileSync(join(durin, "public/providers/simple.svg"), "");

  writeProvider(omni, "present", `
    export const presentProvider = {
      id: "present",
      format: "openai",
      executor: "default",
      authType: "apikey",
      authHeader: "bearer",
      models: [],
    };
  `);
  writeProvider(omni, "simple", `
    export const simpleProvider = {
      id: "simple",
      format: "openai",
      executor: "default",
      baseUrl: "https://example.test/v1/chat/completions",
      authType: "apikey",
      authHeader: "bearer",
      authPrefix: "Bearer ",
      forceStream: true,
      modelIdPrefix: "accounts/example/models/",
      models: [],
    };
  `);
  writeProvider(omni, "chatgpt-web", `
    export const chatgptWebProvider = {
      id: "chatgpt-web",
      format: "openai",
      executor: "chatgpt-web",
      authType: "cookie",
      authHeader: "cookie",
      models: [],
    };
  `);
  writeProvider(omni, "grok-cli", `
    export const grokCliProvider = {
      id: "grok-cli",
      format: "openai",
      executor: "grok-cli",
      authType: "oauth",
      authHeader: "bearer",
      models: [],
    };
  `);
  writeProvider(omni, "requesty", `
    import { buildOpenAiCompatibleRegistryEntry } from "../../shared.ts";
    export const requestyProvider = buildOpenAiCompatibleRegistryEntry({
      id: "requesty",
      alias: "requesty",
      baseUrl: "https://router.requesty.ai/v1/chat/completions",
      models: [],
      passthroughModels: true,
    });
  `);
  writeProvider(omni, "nested/grouped", `
    export const nestedProvider = {
      id: "nested-provider",
      format: "openai",
      executor: "default",
      authType: "apikey",
      authHeader: "bearer",
      models: [],
    };
  `);
  writeFileSync(join(omni, "open-sse/config/providers/registry/nested/index.ts"), `
    import { nestedProvider } from "./grouped/index.ts";
    export default [nestedProvider];
  `);
  writeFileSync(join(omni, "public/providers/simple.png"), "");
  writeFileSync(join(omni, "public/providers/requesty.png"), "");

  return { durin, omni };
}

function writeProvider(root, id, source) {
  const dir = join(root, "open-sse/config/providers/registry", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.ts"), source);
}

describe("OmniRoute provider audit", () => {
  it("classifies provider port work and icon parity", () => {
    const { durin, omni } = makeFixture();
    const audit = buildAudit({ durinRoot: durin, omniRoot: omni, omniCommit: "abc123" });

    expect(audit.totals).toMatchObject({
      durindoorProviders: 1,
      omnirouteProviders: 6,
      present: 1,
      missing: 5,
      missingLocalIcons: 1,
    });
    expect(audit.rows.find((row) => row.id === "simple")).toMatchObject({
      status: "missing",
      class: "simple-default",
      authHeader: "bearer",
      authPrefix: "Bearer ",
      importantFields: ["forceStream", "modelIdPrefix"],
      hasSourceIcon: true,
      hasLocalIcon: true,
      localIconPath: "simple.svg",
    });
    expect(audit.rows.find((row) => row.id === "chatgpt-web")?.class).toBe("web-session");
    expect(audit.rows.find((row) => row.id === "grok-cli")?.class).toBe("oauth-session");
    expect(audit.rows.find((row) => row.id === "requesty")).toMatchObject({
      class: "simple-default",
      executor: "default",
      format: "openai",
      authType: "apikey",
      hasSourceIcon: true,
      hasLocalIcon: false,
    });
    expect(audit.rows.find((row) => row.id === "nested-provider")).toMatchObject({
      sourcePath: "open-sse/config/providers/registry/nested/grouped/index.ts",
      class: "simple-default",
      executor: "default",
    });
  });

  it("renders a Markdown handoff document", () => {
    const { durin, omni } = makeFixture();
    const audit = buildAudit({ durinRoot: durin, omniRoot: omni, omniCommit: "abc123" });
    const markdown = renderMarkdown(audit);

    expect(markdown).toContain("Source commit: `abc123`");
    expect(markdown).toContain("| `simple` | simple-default | default | openai | apikey | bearer | Bearer");
    expect(markdown).toContain("`simple.svg`");
    expect(markdown).toContain("Generated with `node scripts/audit-omniroute-providers.mjs");
  });

  it("verifies a labeled source commit before CLI rendering", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "durindoor-audit-source-"));
    const hostBefore = hostRepositoryState();
    expect(hostBefore.topLevel).toBe(repoRoot);
    expect(hostBefore.coreWorktree).toBe("");

    try {
      expect(runFixtureGit(sourceRoot, ["init"]).status).toBe(0);
      expect(runFixtureGit(sourceRoot, ["-c", "user.name=DurinDoor Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "fixture"]).status).toBe(0);
      const head = runFixtureGit(sourceRoot, ["rev-parse", "HEAD"]).stdout.trim();

      expect(verifySourceCommit(sourceRoot, head)).toBe(head);
      expect(() => verifySourceCommit(sourceRoot, "deadbeef")).toThrow(/does not match --commit/);
      expect(hostRepositoryState()).toEqual(hostBefore);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("rejects dirty source checkouts before CLI rendering", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "durindoor-audit-dirty-source-"));
    const hostBefore = hostRepositoryState();
    expect(hostBefore.topLevel).toBe(repoRoot);
    expect(hostBefore.coreWorktree).toBe("");

    try {
      expect(runFixtureGit(sourceRoot, ["init"]).status).toBe(0);
      expect(runFixtureGit(sourceRoot, ["-c", "user.name=DurinDoor Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "fixture"]).status).toBe(0);
      writeFileSync(join(sourceRoot, "uncommitted.txt"), "dirty\n");

      expect(() => verifyCleanSourceCheckout(sourceRoot)).toThrow(/uncommitted changes/);
      expect(hostRepositoryState()).toEqual(hostBefore);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("prints help when invoked through a symlinked CLI path", () => {
    const linkDir = mkdtempSync(join(tmpdir(), "durindoor-audit-cli-"));
    const scriptPath = join(repoRoot, "scripts/audit-omniroute-providers.mjs");
    const linkPath = join(linkDir, "audit-omniroute-providers.mjs");

    try {
      symlinkSync(scriptPath, linkPath);
      const result = spawnSync(process.execPath, [linkPath, "--help"], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: node scripts/audit-omniroute-providers.mjs");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
  });

  it("keeps explicit classification rules stable", () => {
    expect(classifyProvider({ id: "agentrouter", executor: "default", source: "" })).toBe("simple-default");
    expect(classifyProvider({ id: "yuanbao-web", executor: "yuanbao-web", source: "" })).toBe("web-session");
    expect(classifyProvider({ id: "trae", executor: "trae", source: "" })).toBe("oauth-session");
    expect(classifyProvider({ id: "bedrock", executor: "bedrock", source: "" })).toBe("specialized-executor");
    expect(classifyProvider({
      id: "gigachat",
      executor: "default",
      authType: "apikey",
      source: "baseUrl: \"https://gigachat.devices.sberbank.ru/api/v1/chat/completions\"",
    })).toBe("simple-default");
  });
});
