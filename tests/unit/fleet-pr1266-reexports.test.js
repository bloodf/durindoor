import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { buildAudit } from "../../scripts/audit-omniroute-providers.mjs";

function withRegistryFixture(localFiles, check, source = 'export const upstream = { id: "upstream", executor: "default" };') {
  const root = mkdtempSync(join(tmpdir(), "fleet-pr1266-reexports-"));
  const durinRoot = join(root, "durin");
  const omniRoot = join(root, "omni");
  const localRegistry = join(durinRoot, "open-sse/providers/registry");
  const sourceRegistry = join(omniRoot, "open-sse/config/providers/registry");
  try {
    mkdirSync(localRegistry, { recursive: true });
    mkdirSync(sourceRegistry, { recursive: true });
    for (const [path, source] of Object.entries(localFiles)) {
      const target = join(localRegistry, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    writeFileSync(join(sourceRegistry, "index.ts"), `
      throw new Error("Audited registries must never execute");
      ${source}
    `);
    check(buildAudit({ durinRoot, omniRoot }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("provider audit reexport identities", () => {
  it.each(["traversal", "file symlink", "directory symlink", "entry symlink"])("never reads external bytes through %s", (kind) => {
    const root = mkdtempSync(join(tmpdir(), "fleet-pr1266-containment-"));
    const durinRoot = join(root, "durin");
    const omniRoot = join(root, "omni");
    const registry = join(durinRoot, "open-sse/providers/registry");
    // Prefix sibling catches string-prefix containment checks too.
    const external = join(root, "durin-external");
    let spy;
    try {
      mkdirSync(registry, { recursive: true });
      mkdirSync(join(omniRoot, "open-sse/config/providers/registry"), { recursive: true });
      mkdirSync(external);
      const secret = join(external, "secret.js");
      writeFileSync(secret, 'throw new Error("Never execute"); export const provider = { id: "external-secret", alias: "upstream" };');
      writeFileSync(join(omniRoot, "open-sse/config/providers/registry/index.ts"), 'export default { id: "upstream", executor: "default" };');
      let source = "../../../../durin-external/secret.js";
      if (kind === "file symlink") {
        symlinkSync(secret, join(registry, "linked.js"));
        source = "./linked.js";
      } else if (kind === "directory symlink") {
        symlinkSync(external, join(registry, "linked"));
        source = "./linked/secret.js";
      }
      if (kind === "entry symlink") symlinkSync(secret, join(registry, "index.js"));
      else writeFileSync(join(registry, "index.js"), `export { provider } from ${JSON.stringify(source)};`);
      spy = vi.spyOn(fs, "readFileSync").mockImplementation(readFileSync);
      syncBuiltinESMExports();
      const audit = buildAudit({ durinRoot, omniRoot });
      const reads = spy.mock.calls.map(([path]) => fs.realpathSync(path));
      expect(reads).not.toContain(fs.realpathSync(secret));
      expect(audit.evidence.localProviders).toEqual([]);
      expect(audit.evidence.unresolved).toContainEqual({
        side: "durindoor", path: expect.any(String),
        reason: expect.stringMatching(/outside audited root.*(unsupported|include)/i),
      });
    } finally {
      spy?.mockRestore();
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows parent-relative shared modules within the real audited root", () => {
    withRegistryFixture({
      "index.js": 'export { provider } from "../shared.js";',
      "../shared.js": 'throw new Error("Never execute"); export const provider = { id: "local", alias: "upstream" };',
    }, (audit) => {
      expect(audit.evidence.localProviders.map(({ id }) => id)).toEqual(["local"]);
      expect(audit.evidence.unresolved).toEqual([]);
      expect(audit.rows[0]).toMatchObject({ status: "present", match: { localIds: ["local"] } });
    });
  });

  it("reports opaque computed metadata without guessing executor classification", () => {
    withRegistryFixture({ "index.js": 'export default [{ id: "upstream" }];' }, (audit) => {
      expect(audit.rows[0]).toMatchObject({
        id: "upstream", status: "present", class: "unknown", executor: "unknown",
        aliasesComplete: false, dynamicFields: expect.arrayContaining(["executor", "<spread>"]),
      });
      expect(audit.evidence.unresolved).toContainEqual({
        side: "omniroute", path: "open-sse/config/providers/registry/index.ts",
        reason: expect.stringContaining("computed property"),
      });
    }, `export default { executor: "default", [dynamicKey()]: "custom", id: "upstream", format: "openai" };`);
  });

  it("reports dynamic exported collections instead of silently omitting their identities", () => {
    withRegistryFixture({ "index.js": 'export default [];' }, (audit) => {
      expect(audit.rows).toEqual([]);
      expect(audit.evidence.unresolved).toContainEqual({
        side: "omniroute", path: "open-sse/config/providers/registry/index.ts",
        reason: expect.stringContaining("ConditionalExpression"),
      });
    }, `export default dynamicFlag ? [{ id: "upstream", executor: "default" }] : [];`);
  });

  it("keeps identical diamond reexports unambiguous and terminates cyclic barrels", () => {
    withRegistryFixture({
      "index.js": 'export * from "./left.js"; export * from "./right.js";',
      "left.js": 'export * from "./entries.js"; export * from "./index.js";',
      "right.js": 'export { provider } from "./entries.js";',
      "entries.js": 'export const provider = { id: "local", alias: "upstream" };',
    }, (audit) => {
      expect(audit.evidence.localProviders.map(({ id }) => id)).toEqual(["local"]);
      expect(audit.evidence.unresolved).toEqual([]);
      expect(audit.evidence.duplicateIds.durindoor).toEqual([]);
      expect(audit.rows[0]).toMatchObject({ status: "present", match: { kind: "alias", localIds: ["local"] } });
    });
  });

  it("fails closed when a missing star dependency might conflict with a known export", () => {
    withRegistryFixture({
      "index.js": 'export * from "./entries.js"; export * from "./missing.js";',
      "entries.js": 'export const provider = { id: "local", alias: "upstream" };',
    }, (audit) => {
      expect(audit.evidence.localProviders).toEqual([]);
      expect(audit.evidence.unresolved).toContainEqual({
        side: "durindoor", path: "open-sse/providers/registry/index.js",
        reason: expect.stringContaining("unresolved star export ./missing.js"),
      });
    });
  });

  it("does not preserve a canonical id overwritten by an opaque computed field", () => {
    withRegistryFixture({ "index.js": 'export default [];' }, (audit) => {
      expect(audit.rows).toEqual([]);
      expect(audit.evidence.unresolved).toContainEqual({
        side: "omniroute", path: "open-sse/config/providers/registry/index.ts",
        reason: expect.stringContaining("provider id not statically resolvable"),
      });
    }, `export default { id: "upstream", executor: "default", [dynamicKey()]: "changed" };`);
  });

  it("resolves renamed named reexports of grouped arrays without duplicating provider identities", () => {
    withRegistryFixture({
      "index.js": 'export { renamed as default } from "./barrel.js";',
      "barrel.js": 'export { entries as renamed } from "./entries.js";',
      "entries.js": `
        throw new Error("Audited reexports must never execute");
        const provider = { id: "local", aliases: ["upstream", "upstream"] };
        const privateEntry = { id: "private" };
        export const entries = [provider, provider];
      `,
    }, (audit) => {
      expect(audit.evidence.localProviders).toEqual([
        expect.objectContaining({ id: "local", aliases: ["upstream"], aliasesComplete: true }),
      ]);
      expect(audit.evidence.duplicateIds.durindoor).toEqual([]);
      expect(audit.evidence.unresolved).toEqual([]);
      expect(audit.rows[0]).toMatchObject({
        status: "present", match: { kind: "alias", localIds: ["local"] },
      });
    });
  });

  it("lets an explicit named reexport override conflicting stars", () => {
    withRegistryFixture({
      "index.js": 'import { entry } from "./barrel.js"; export default [entry];',
      "barrel.js": `
        export * from "./left.js";
        export * from "./right.js";
        export { entry } from "./right.js";
      `,
      "left.js": 'export const entry = { id: "left", alias: "upstream" };',
      "right.js": 'export const entry = { id: "right", alias: "upstream" };',
    }, (audit) => {
      expect(audit.evidence.localProviders.map(({ id }) => id)).toEqual(["right"]);
      expect(audit.evidence.unresolved).toEqual([]);
      expect(audit.rows[0]).toMatchObject({
        status: "present", match: { kind: "alias", localIds: ["right"] },
      });
    });
  });

  it("counts providers exported only through a star barrel, excluding its default and private bindings", () => {
    withRegistryFixture({
      "index.js": 'export * from "./barrel.js";',
      "barrel.js": 'export * from "./entries.js";',
      "entries.js": `
        throw new Error("Audited reexports must never execute");
        const privateEntry = { id: "private", alias: "upstream" };
        const model = { id: "model-only", name: "Not a provider" };
        export const provider = { id: "local", alias: "upstream" };
        export default { id: "default-not-reexported" };
      `,
    }, (audit) => {
      // Local registry exports define membership, including named star exports.
      expect(audit.evidence.localProviders.map(({ id }) => id)).toEqual(["local"]);
      expect(audit.evidence.localProviders.find(({ id }) => id === "local")).toMatchObject({
        aliases: ["upstream"], sourcePath: "open-sse/providers/registry/entries.js",
      });
      expect(audit.rows[0]).toMatchObject({
        id: "upstream", status: "present", match: { kind: "alias", localIds: ["local"] },
      });
      expect(audit.evidence.duplicateIds.durindoor).toEqual([]);
      expect(audit.evidence.unresolved).toEqual([]);
    });
  });

  it.each([
    ['export * from "./left.js"; export * from "./right.js";'],
    ['export * from "./right.js"; export * from "./left.js";'],
  ])("does not invent an identity from conflicting star exports: %s", (barrel) => {
    withRegistryFixture({
      "index.js": `
        import { entry } from "./barrel.js";
        export default [entry];
      `,
      "barrel.js": barrel,
      "left.js": 'export const entry = { id: "left", alias: "upstream" };',
      "right.js": 'export const entry = { id: "right", alias: "upstream" };',
    }, (audit) => {
      // ESM has no unambiguous "entry" export; barrel order must not choose a provider.
      expect(audit.evidence.localProviders).toEqual([]);
      expect(audit.rows[0]).toMatchObject({ status: "missing", match: { kind: "none", localIds: [] } });
      expect(audit.evidence.unresolved).toContainEqual({
        side: "durindoor",
        path: expect.any(String),
        reason: expect.stringMatching(/ambiguous|unresolved/i),
      });
    });
  });
});
