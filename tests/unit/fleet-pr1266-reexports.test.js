import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAudit } from "../../scripts/audit-omniroute-providers.mjs";

function withRegistryFixture(localFiles, check) {
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
      export const upstream = { id: "upstream", executor: "default" };
    `);
    check(buildAudit({ durinRoot, omniRoot }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("provider audit reexport identities", () => {
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
