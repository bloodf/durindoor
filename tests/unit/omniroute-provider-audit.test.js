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
  writeFileSync(join(omni, "open-sse/config/providers/shared.ts"), `
    throw new Error("audited helper modules must never execute");
    export function buildOpenAiCompatibleRegistryEntry(overrides) {
      return {
        format: "openai", executor: "default", authType: "apikey",
        authHeader: "bearer", ...overrides,
      };
    }
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

  it("reads exported identity statically, not model constants or comments", () => {
    const { durin, omni } = makeFixture();
    const dir = join(omni, "open-sse/config/providers/registry");
    mkdirSync(join(dir, "tricky"), { recursive: true });
    mkdirSync(join(dir, "group/a"), { recursive: true });
    mkdirSync(join(dir, "group/b"), { recursive: true });
    writeFileSync(join(dir, "tricky/index.ts"), `
      import { buildOpenAiCompatibleRegistryEntry } from "../../shared.ts";
      // id: "comment-id"
      const MODEL = { id: "model-const", name: "not a provider" };
      const base = { format: "openai", executor: "default", authType: "apikey", authHeader: "bearer" };
      const NOTE = "id: 'string-id'";
      export const first = { ...base, id: "first-real", alias: "fr", models: [MODEL] } as const;
      export const second = buildOpenAiCompatibleRegistryEntry({ id: "second-real", alias: "sr", models: [] });
      export const third = { id: "first-real", aliases: ["extra"], format: "openai", executor: "default" };
      export const dyn = { id: makeId(), format: "openai" };
    `);
    writeFileSync(join(dir, "group/a/index.ts"), `export const a = { id: "grouped-a", format: "openai", executor: "default" };`);
    writeFileSync(join(dir, "group/b/index.ts"), `export const b = { id: "grouped-b", format: "openai", executor: "default" };`);
    writeFileSync(join(dir, "group/index.ts"), `
      import { a } from "./a/index.ts";
      import { b } from "./b/index.ts";
      const list = [a, b];
      export default [...list];
    `);
    // grouped providers have no local file named after the id
    writeFileSync(join(durin, "open-sse/providers/registry/index.js"), `
      import p0 from "./present.js";
      import g from "./grouped-file.js";
      export default [p0, ...g];
    `);
    writeFileSync(join(durin, "open-sse/providers/registry/grouped-file.js"), `
      const NAME = { id: "model-const" };
      export default [{ id: "grouped-a" }, { id: "grouped-b" }];
    `);

    const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
    const ids = audit.rows.map((row) => row.id);
    for (const bad of ["model-const", "comment-id", "string-id"]) expect(ids).not.toContain(bad);
    expect(ids.filter((id) => id === "first-real")).toHaveLength(1);
    expect(ids).toEqual(expect.arrayContaining(["first-real", "second-real", "grouped-a", "grouped-b"]));
    expect(audit.rows.find((row) => row.id === "first-real")).toMatchObject({ aliases: ["fr", "extra"], executor: "default" });
    expect(audit.rows.find((row) => row.id === "second-real")).toMatchObject({ format: "openai", executor: "default" });
    expect(audit.rows.find((row) => row.id === "grouped-a").status).toBe("present");
    expect(audit.rows.find((row) => row.id === "grouped-b").status).toBe("present");
    expect(audit.evidence.duplicateIds.omniroute).toEqual(["first-real"]);
    expect(audit.evidence.unresolved.some((item) => /id not statically resolvable/.test(item.reason))).toBe(true);
    expect(audit.evidence.commitVerified).toBe(false);
  });

  it("resolves helper bindings and return spreads instead of trusting helper names", () => {
    const { durin, omni } = makeFixture();
    try {
      writeProvider(omni, "fake-helper", `
        const buildOpenAiCompatibleRegistryEntry = () => null;
        export default buildOpenAiCompatibleRegistryEntry({ id: "fabricated-local", models: [] });
      `);
      writeProvider(omni, "missing-helper", `
        import { buildOpenAiCompatibleRegistryEntry } from "../../missing.ts";
        export default buildOpenAiCompatibleRegistryEntry({ id: "fabricated-import", models: [] });
      `);
      writeProvider(omni, "unbound-helper", `
        export default buildOpenAiCompatibleRegistryEntry({ id: "fabricated-unbound", models: [] });
      `);
      writeProvider(omni, "renamed-helper", `
        import { buildOpenAiCompatibleRegistryEntry as build } from "../../shared.ts";
        export default build({ id: "renamed-real", executor: "custom", format: "claude" });
      `);
      writeProvider(omni, "return-order", `
        function buildOpenAiCompatibleRegistryEntry(overrides) {
          return { ...overrides, id: "returned-id", executor: "custom" };
        }
        export default buildOpenAiCompatibleRegistryEntry({ id: "argument-id", executor: "default" });
      `);
      writeProvider(omni, "unsupported-helper", `
        function buildOpenAiCompatibleRegistryEntry(overrides) {
          sideEffect();
          return { ...overrides, executor: "default" };
        }
        export default buildOpenAiCompatibleRegistryEntry({ id: "unsupported-body" });
      `);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      for (const id of ["fabricated-local", "fabricated-import", "fabricated-unbound", "argument-id", "unsupported-body"]) {
        expect(audit.rows.map((row) => row.id)).not.toContain(id);
      }
      expect(audit.rows.find((row) => row.id === "renamed-real")).toMatchObject({
        executor: "custom", format: "claude", authType: "apikey", authHeader: "bearer",
      });
      expect(audit.rows.find((row) => row.id === "returned-id")).toMatchObject({ executor: "custom" });
      for (const name of ["fake-helper", "missing-helper", "unbound-helper", "unsupported-helper"]) {
        expect(audit.evidence.unresolved).toContainEqual({
          side: "omniroute", path: `open-sse/config/providers/registry/${name}/index.ts`,
          reason: expect.stringContaining("call buildOpenAiCompatibleRegistryEntry() not statically resolvable"),
        });
      }
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it("resolves object-pattern factories by body shape with isolated arguments and defaults", () => {
    const { durin, omni } = makeFixture();
    try {
      const registry = join(durin, "open-sse/providers/registry");
      writeFileSync(join(registry, "constants.js"), `
        const PREFIX = "constant-id";
        export const ID = PREFIX;
        export const ALIASES = ["upstream-a"];
      `);
      writeFileSync(join(registry, "barrel.js"), `export * from "./constants.js";`);
      writeFileSync(join(registry, "factory.js"), `
        throw new Error("audited modules must never execute");
        const DEFAULT_ALIAS = "default-alias";
        const bearerAuth = { header: "Authorization", scheme: "bearer" };
        const id = "outer-id-must-not-leak";
        export const arbitraryFactory = ({
          key: id, alias = DEFAULT_ALIAS, aliases = [], name,
          baseUrl, enabled = false, models = []
        }) => ({
          id, alias, aliases,
          display: { name }, category: "apikey",
          ...(enabled ? { hasProviderSpecificData: true } : null),
          transport: { baseUrl, headers: {}, auth: bearerAuth },
          models, passthroughModels: true
        });
      `);
      writeFileSync(join(registry, "present.js"), `
        import { arbitraryFactory as renamed } from "./factory.js";
        import { ID, ALIASES } from "./barrel.js";
        const DEFAULT_ALIAS = "caller-alias-must-not-leak";
        const ENTRY = { key: ID, aliases: ALIASES, name: "First" };
        const second = renamed({ key: "second-id", alias: "upstream-b", enabled: true });
        export default [
          renamed(ENTRY), second,
          renamed({ key: "third-id", alias: dynamicAlias() }),
          renamed({ name: "Missing key must shadow outer id" }),
          renamed({ key: "must-not-guess", ...dynamicOptions() })
        ];
      `);
      writeProvider(omni, "upstream-a", `export default { id: "upstream-a", executor: "default" };`);
      writeProvider(omni, "upstream-b", `export default { id: "upstream-b", executor: "default" };`);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.evidence.localProviders.map(({ id, aliases, dynamicFields }) => ({ id, aliases, dynamicFields }))).toEqual([
        { id: "constant-id", aliases: ["default-alias", "upstream-a"], dynamicFields: [] },
        { id: "second-id", aliases: ["upstream-b"], dynamicFields: [] },
        { id: "third-id", aliases: [], dynamicFields: ["alias"] },
      ]);
      expect(audit.rows.find((row) => row.id === "upstream-a")).toMatchObject({
        status: "ambiguous", match: { kind: "ambiguous", localIds: ["constant-id"] },
      });
      expect(audit.rows.find((row) => row.id === "upstream-b")).toMatchObject({
        status: "ambiguous", match: { kind: "ambiguous", localIds: ["second-id"] },
      });
      expect(audit.evidence.unresolved.filter((item) => item.side === "durindoor").map((item) => item.reason).sort()).toEqual([
        expect.stringContaining("call renamed() not statically resolvable"),
        expect.stringContaining("provider id not statically resolvable"),
        expect.stringContaining("provider third-id aliases not statically resolvable"),
      ]);
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it.each([
    ["absent", "", "", ["bridge"], true, "present"],
    ["unshadowed undefined", "", ", alias: undefined", ["bridge"], true, "present"],
    ["bound undefined", "const absent = undefined;", ", alias: absent", ["bridge"], true, "present"],
    ["null", "", ", alias: null", [], true, "missing"],
    ["known shadowed undefined", 'const undefined = "other";', ", alias: undefined", ["other"], true, "missing"],
    ["unknown shadowed undefined", "const undefined = dynamicAlias();", ", alias: undefined", [], false, "ambiguous"],
    ["unknown identifier", "", ", alias: unknownAlias", [], false, "ambiguous"],
    ["dynamic expression", "", ", alias: dynamicAlias()", [], false, "ambiguous"],
  ])("applies factory alias defaults correctly for %s", (_name, declaration, property, aliases, complete, status) => {
    const { durin, omni } = makeFixture();
    try {
      const registry = join(durin, "open-sse/providers/registry");
      writeFileSync(join(registry, "factory.js"), `
        export const factory = ({ id, alias = "bridge" }) => ({ id, alias });
      `);
      writeFileSync(join(registry, "present.js"), `
        import { factory } from "./factory.js";
        ${declaration}
        export default factory({ id: "local"${property} });
      `);
      writeProvider(omni, "bridge", `export default { id: "bridge", executor: "default" };`);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.evidence.localProviders).toEqual([
        expect.objectContaining({
          id: "local", aliases, aliasesComplete: complete, dynamicFields: complete ? [] : ["alias"],
        }),
      ]);
      expect(audit.rows.find((row) => row.id === "bridge")).toMatchObject({
        status, match: { kind: status === "present" ? "alias" : status === "missing" ? "none" : "ambiguous" },
      });
      if (complete) expect(audit.evidence.unresolved).toEqual([]);
      else expect(audit.evidence.unresolved).toContainEqual({
        side: "durindoor", path: "open-sse/providers/registry/present.js",
        reason: expect.stringContaining("provider local aliases not statically resolvable; collision evidence incomplete"),
      });
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it("distinguishes shared config constants from dynamic ids and reports unsupported model transforms", () => {
    const { durin, omni } = makeFixture();
    try {
      writeProvider(omni, "shared/coding", `
        const CANONICAL_ID = "coding-id";
        const URL = "https://example.test/anthropic";
        export const MODELS = [{ id: "model-only", name: "Model" }];
        export const SHARED = { format: "claude", executor: "default", baseUrl: URL, models: MODELS };
        export const provider = { id: CANONICAL_ID, alias: "coding", ...SHARED, authType: "oauth" };
      `);
      writeProvider(omni, "transformed", `
        const MODELS = [{ id: "model-only" }];
        const EXCLUDED = new Set(["excluded-model"]);
        export const TRANSFORMED = MODELS.filter((model) => !EXCLUDED.has(model.id))
          .map((model) => ({ ...model, supportedThinkingEfforts: [] }));
        export const provider = { id: "transformed-id", executor: "custom", models: TRANSFORMED };
        export const dynamic = { id: makeId(), format: "openai" };
        export const overwritten = { id: "unsafe-id", format: "openai", ...unknownFields() };
      `);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.rows.find((row) => row.id === "coding-id")).toMatchObject({
        aliases: ["coding"], format: "claude", executor: "default", authType: "oauth", dynamicFields: [],
      });
      expect(audit.rows.find((row) => row.id === "transformed-id")).toMatchObject({
        executor: "custom", dynamicFields: ["models"],
      });
      expect(audit.rows.map((row) => row.id)).not.toContain("model-only");
      expect(audit.rows.map((row) => row.id)).not.toContain("unsafe-id");
      expect(audit.evidence.unresolved.map((item) => ({ path: item.path, reason: item.reason }))).toEqual([
        { path: "open-sse/config/providers/registry/transformed/index.ts", reason: expect.stringContaining("not statically resolvable") },
        { path: "open-sse/config/providers/registry/transformed/index.ts", reason: expect.stringContaining("provider id not statically resolvable") },
        { path: "open-sse/config/providers/registry/transformed/index.ts", reason: expect.stringContaining("provider id not statically resolvable") },
      ]);
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it("matches explicit id-alias bridges without guessing transport equivalence", () => {
    const { durin, omni } = makeFixture();
    try {
      writeFileSync(join(durin, "open-sse/providers/registry/present.js"), `
        throw new Error("registry must never execute");
        const ALIASES = ["upstream-id", "upstream-id"];
        export default [
          { id: "present", aliases: ALIASES },
          { id: "reverse-local", alias: "shared-only" },
          { id: "left", alias: "collision" },
          { id: "right", aliases: ["collision", "left"] },
          { id: "named", name: "display-name" },
          { id: "Case-ID" },
          { id: "source-target" },
        ];
      `);
      const entries = [
        { id: "upstream-id" },
        { id: "reverse-upstream", alias: "reverse-local" },
        { id: "alias-only", alias: "shared-only" },
        { id: "collision" },
        { id: "left" },
        { id: "display-name" },
        { id: "case-id" },
        { id: "multi", aliases: ["named", "Case-ID"] },
        { id: "source-a", alias: "source-target" },
        { id: "source-b", alias: "source-target" },
        { id: "loose-file" },
      ];
      for (const entry of entries) {
        writeProvider(omni, entry.id, `export default ${JSON.stringify({ ...entry, executor: "default" })};`);
      }
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      const row = (id) => audit.rows.find((item) => item.id === id);
      expect(audit.evidence.localProviders.find((item) => item.id === "present")).toMatchObject({
        aliases: ["upstream-id"], sourcePath: "open-sse/providers/registry/present.js",
      });
      expect(row("upstream-id")).toMatchObject({
        status: "present", match: { kind: "alias", localIds: ["present"], tokens: ["upstream-id"] },
        hasLocalIcon: false,
      });
      expect(row("reverse-upstream")).toMatchObject({
        status: "present", match: { kind: "alias", localIds: ["reverse-local"] },
      });
      for (const id of ["alias-only", "display-name", "case-id", "loose-file"]) {
        expect(row(id)).toMatchObject({ status: "missing", match: { kind: "none", localIds: [] } });
      }
      expect(row("collision")).toMatchObject({ status: "ambiguous", match: { localIds: ["left", "right"] } });
      expect(row("multi")).toMatchObject({ status: "ambiguous", match: { localIds: ["Case-ID", "named"] } });
      for (const id of ["source-a", "source-b"]) expect(row(id).status).toBe("ambiguous");
      expect(row("left")).toMatchObject({ status: "present", match: { kind: "canonical-id", localIds: ["left"] } });
      expect(audit.evidence.aliasCollisions.durindoor).toEqual([
        { name: "collision", ids: ["left", "right"] }, { name: "left", ids: ["left", "right"] },
      ]);
      expect(audit.evidence.aliasCollisions.omniroute).toEqual([{ name: "source-target", ids: ["source-a", "source-b"] }]);
      expect(audit.totals.ambiguous).toBe(4);
      expect(audit.totals.present + audit.totals.missing + audit.totals.ambiguous).toBe(audit.totals.omnirouteProviders);
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it("resolves imported alias spreads and detects their collisions", () => {
    const { durin, omni } = makeFixture();
    try {
      const registry = join(durin, "open-sse/providers/registry");
      writeFileSync(join(registry, "aliases.js"), `export const EXTRA = ["bridge"]; export const ALL = [...EXTRA];`);
      writeFileSync(join(registry, "present.js"), `
        import { ALL } from "./aliases.js";
        export default [{ id: "present", aliases: [...ALL] }, { id: "other", aliases: [...ALL] }];
      `);
      writeProvider(omni, "bridge", `export default { id: "bridge", executor: "default" };`);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.rows.find((row) => row.id === "bridge")).toMatchObject({
        status: "ambiguous", match: { localIds: ["other", "present"] },
      });
      expect(audit.evidence.aliasCollisions.durindoor).toContainEqual({ name: "bridge", ids: ["other", "present"] });
      expect(audit.evidence.localProviders.find((row) => row.id === "other")).toMatchObject({ aliasesComplete: true, aliases: ["bridge"] });
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it.each(["undefined", "null"])("treats explicit %s aliases as known absent", (value) => {
    const { durin, omni } = makeFixture();
    try {
      writeFileSync(join(durin, "open-sse/providers/registry/present.js"), `
        const absent = ${value};
        export default { id: "present", alias: absent, aliases: ["bridge"] };
      `);
      writeProvider(omni, "absent", `export default { id: "absent", executor: "default", alias: ${value} };`);
      writeProvider(omni, "bridge", `export default { id: "bridge", executor: "default" };`);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.rows.find((row) => row.id === "absent")).toMatchObject({
        status: "missing", aliases: [], aliasesComplete: true, dynamicFields: [],
      });
      expect(audit.evidence.localProviders.find((row) => row.id === "present")).toMatchObject({
        aliases: ["bridge"], aliasesComplete: true, dynamicFields: [],
      });
      expect(audit.rows.find((row) => row.id === "bridge")).toMatchObject({ status: "present", match: { kind: "alias" } });
      expect(audit.evidence.unresolved).toEqual([]);
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it.each([
    ["dynamic expression", "", "dynamicAlias()"],
    ["unknown identifier", "", "unknownAlias"],
    ["shadowed undefined", "const undefined = dynamicAlias();", "undefined"],
    ["destructured undefined", "const { undefined } = dynamicAliases();", "undefined"],
    ["uninitialized undefined", "let undefined;", "undefined"],
    ["namespace undefined", 'import * as undefined from "../../shared.ts";', "undefined"],
    ["class undefined", "class undefined {}", "undefined"],
    ["exported class undefined", "export class undefined {}", "undefined"],
  ])("preserves incomplete collision evidence for %s", (_name, declaration, alias) => {
    const { durin, omni } = makeFixture();
    try {
      writeFileSync(join(durin, "open-sse/providers/registry/present.js"), `export default { id: "present", alias: "bridge" };`);
      writeProvider(omni, "bridge", `export default { id: "bridge", executor: "default" };`);
      writeProvider(omni, "unknown", `${declaration}
        export default { id: "unknown", executor: "default", alias: ${alias} };
      `);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.rows.find((row) => row.id === "unknown")).toMatchObject({
        aliases: [], aliasesComplete: false, dynamicFields: ["alias"],
      });
      expect(audit.rows.find((row) => row.id === "bridge")).toMatchObject({ status: "ambiguous", match: { localIds: ["present"] } });
      expect(audit.rows.find((row) => row.id === "simple").status).toBe("ambiguous");
      expect(audit.rows.find((row) => row.id === "present")).toMatchObject({ status: "present", match: { kind: "canonical-id" } });
      expect(audit.evidence.unresolved).toContainEqual({
        side: "omniroute", path: expect.any(String), reason: expect.stringContaining("collision evidence incomplete"),
      });
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it("resolves a shadowed undefined alias through its binding", () => {
    const { durin, omni } = makeFixture();
    try {
      writeFileSync(join(durin, "open-sse/providers/registry/present.js"), `
        export default [{ id: "present" }, { id: "shadowed-local" }];
      `);
      writeProvider(omni, "shadowed", `
        const undefined = "shadowed-local";
        export default { id: "shadowed", executor: "default", alias: undefined };
      `);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.rows.find((row) => row.id === "shadowed")).toMatchObject({
        status: "present", aliases: ["shadowed-local"], aliasesComplete: true, dynamicFields: [],
        match: { kind: "alias", localIds: ["shadowed-local"], tokens: ["shadowed-local"] },
      });
      expect(audit.evidence.aliasCollisions).toEqual({ durindoor: [], omniroute: [] });
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it.each(["durindoor", "omniroute"])("keeps matches uncertain with unknown %s aliases", (side) => {
    const { durin, omni } = makeFixture();
    try {
      writeFileSync(join(durin, "open-sse/providers/registry/present.js"), `
        export default [{ id: "present", alias: "bridge" },
          ${side === "durindoor" ? '{ id: "unknown", aliases: ["known", ...dynamicAliases()] }, { id: "unknown", aliases: [] }' : ''}];
      `);
      writeProvider(omni, "bridge", `export default { id: "bridge", executor: "default" };`);
      if (side === "omniroute") writeProvider(omni, "unknown", `
        export const first = { id: "unknown", executor: "default", aliases: ["known", dynamicAlias()] };
        export const second = { id: "unknown", executor: "default", aliases: [] };
      `);
      const audit = buildAudit({ durinRoot: durin, omniRoot: omni });
      expect(audit.rows.find((row) => row.id === "bridge")).toMatchObject({ status: "ambiguous", match: { localIds: ["present"] } });
      expect(audit.rows.find((row) => row.id === "simple").status).toBe("ambiguous");
      expect(audit.rows.find((row) => row.id === "present")).toMatchObject({ status: "present", match: { kind: "canonical-id" } });
      const unknown = (side === "durindoor" ? audit.evidence.localProviders : audit.rows).find((row) => row.id === "unknown");
      expect(unknown).toMatchObject({ aliases: ["known"], aliasesComplete: false, dynamicFields: ["aliases"] });
      expect(audit.evidence.unresolved).toContainEqual({ side, path: expect.any(String), reason: expect.stringContaining("collision evidence incomplete") });
    } finally {
      rmSync(dirname(durin), { recursive: true, force: true });
    }
  });

  it("verifies the requested checkout despite hostile Git repository selectors", () => {
    const root = mkdtempSync(join(tmpdir(), "durindoor-audit-hostile-env-"));
    const source = join(root, "source");
    const decoy = join(root, "decoy");
    try {
      for (const dir of [source, decoy]) {
        mkdirSync(dir);
        expect(runFixtureGit(dir, ["init"]).status).toBe(0);
        writeFileSync(join(dir, "tracked.txt"), dir);
        expect(runFixtureGit(dir, ["add", "tracked.txt"]).status).toBe(0);
        expect(runFixtureGit(dir, ["-c", "user.name=DurinDoor Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"]).status).toBe(0);
      }
      const head = runFixtureGit(source, ["rev-parse", "HEAD"]).stdout.trim();
      const decoyHead = runFixtureGit(decoy, ["rev-parse", "HEAD"]).stdout.trim();
      expect(head).not.toBe(decoyHead);
      const env = {
        ...process.env,
        GIT_DIR: join(decoy, ".git"), GIT_WORK_TREE: decoy,
        GIT_INDEX_FILE: join(decoy, ".git/index"), GIT_COMMON_DIR: join(decoy, ".git"),
        GIT_OBJECT_DIRECTORY: join(decoy, ".git/objects"),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoy, ".git/objects"),
      };
      const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", `
        import { readSourceHead, verifySourceCommit, verifyCleanSourceCheckout } from ${JSON.stringify(new URL("../../scripts/audit-omniroute-providers.mjs", import.meta.url).href)};
        const source = ${JSON.stringify(source)};
        const head = readSourceHead(source);
        const verified = verifySourceCommit(source, ${JSON.stringify(head)});
        let clean;
        try { clean = verifyCleanSourceCheckout(source); }
        catch (error) { clean = error.message; }
        console.log(JSON.stringify({ head, verified, clean }));
      `], { encoding: "utf8", env });
      writeFileSync(join(decoy, "tracked.txt"), "dirty decoy");
      let result = run();
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ head, verified: head, clean: true });
      writeFileSync(join(decoy, "tracked.txt"), decoy);
      writeFileSync(join(source, "tracked.txt"), "dirty source");
      result = run();
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ head, verified: head, clean: expect.stringContaining("uncommitted changes") });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
