import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAudit } from "../../scripts/audit-omniroute-providers.mjs";
import { installExecutorContract } from "../fixtures/omniroute-executor-audit/install.js";

function fixture(revision, check) {
  const root = mkdtempSync(join(tmpdir(), "executor-audit-"));
  const durinRoot = join(root, "durin");
  const omniRoot = join(root, "omni");
  try {
    mkdirSync(join(durinRoot, "open-sse/providers/registry"), { recursive: true });
    writeFileSync(join(durinRoot, "open-sse/providers/registry/index.js"), "export default [];");
    installExecutorContract(omniRoot, revision);
    for (const id of ["nlpcloud", "oneminai", "agentrouter"]) {
      const dir = join(omniRoot, "open-sse/config/providers/registry", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.ts"), readFileSync(new URL(`../fixtures/omniroute-executor-audit/${id}-${revision}.txt`, import.meta.url)));
    }
    check(() => buildAudit({ durinRoot, omniRoot }), omniRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("actual OmniRoute executor precedence", () => {
  it.each(["61e07fb7", "191dce8d"])("classifies actual source at %s without executing TypeScript", (revision) => {
    fixture(revision, (audit) => {
      const rows = Object.fromEntries(audit().rows.map((row) => [row.id, row]));
      expect(rows.nlpcloud).toMatchObject({ executor: "default", class: "specialized-executor", status: "missing" });
      expect(rows.oneminai).toMatchObject({ executor: "default", class: "specialized-executor", status: "missing" });
      expect(rows.agentrouter).toMatchObject({ executor: "default", class: "simple-default", status: "missing" });
    });
  });

  it.each(["61e07fb7", "191dce8d"])("rejects byte drift in every contract file at %s", (revision) => {
    for (const file of ["index.ts", "registry.ts", "defaultResolver.ts"]) {
      fixture(revision, (audit, root) => {
        const path = join(root, "open-sse/executors", file);
        writeFileSync(path, `${readFileSync(path, "utf8")}\n// contract drift\n`);
        const result = audit();
        expect(result.rows.map((row) => [row.id, row.class])).toEqual([
          ["agentrouter", "unknown"], ["nlpcloud", "unknown"], ["oneminai", "unknown"],
        ]);
        expect(result.evidence.unresolved).toContainEqual(expect.objectContaining({
          side: "omniroute", reason: expect.stringContaining("executor resolution contract unrecognized"),
        }));
      });
    }
  });

  it.each(["missing", "syntax", "registration", "fallback"])("fails closed for unknown %s contract", (kind) => {
    fixture("191dce8d", (audit, root) => {
      const path = join(root, "open-sse/executors", kind === "fallback" ? "defaultResolver.ts" : "index.ts");
      if (kind === "missing") rmSync(path);
      else if (kind === "syntax") writeFileSync(path, "export const = ;");
      else writeFileSync(path, readFileSync(path, "utf8").replace(kind === "fallback" ? "new DefaultExecutor(provider)" : "registerLazyExecutor(alias, load)", kind === "fallback" ? "new OtherExecutor(provider)" : "registerLazyExecutor(alias, otherLoad)"));
      const result = audit();
      expect(result.rows.map((row) => row.class)).toEqual(["unknown", "unknown", "unknown"]);
      expect(result.evidence.unresolved).toContainEqual(expect.objectContaining({
        side: "omniroute", reason: expect.stringContaining("executor resolution contract unrecognized"),
      }));
    });
  });
});
