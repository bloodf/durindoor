import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listRegistryFiles,
  generateIndex,
  isArrayExport,
  main,
} from "../../scripts/gen-registry-index.mjs";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reg-idx-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name, source) {
  await writeFile(path.join(dir, name), source, "utf8");
}

describe("gen-registry-index", () => {
  it("lists *.js except index.js, code-point sorted (locale-independent)", async () => {
    await writeFixture("zed.js", "export default {};");
    await writeFixture("9router.js", "export default {};");
    await writeFixture("Alpha.js", "export default {};");
    await writeFixture("index.js", "// barrel — must be excluded");
    await writeFixture("notes.txt", "ignored");
    // ASCII/code-point order: digits < uppercase < lowercase; index.js excluded.
    expect(await listRegistryFiles(dir)).toEqual(["9router.js", "Alpha.js", "zed.js"]);
  });

  it("isArrayExport distinguishes array vs object default exports", async () => {
    await writeFixture("arr.js", "export default [{ id: 'a' }];");
    await writeFixture("obj.js", "export default { id: 'a' };");
    expect(await isArrayExport(path.join(dir, "arr.js"))).toBe(true);
    expect(await isArrayExport(path.join(dir, "obj.js"))).toBe(false);
  });

  it("does NOT spread an object module even when a comment says 'export default ['", async () => {
    await writeFixture(
      "tricky.js",
      "/**\n * Was: export default [ ... ] — now an object. Must not spread.\n */\nexport default { id: 'tricky' };\n",
    );
    const out = await generateIndex(dir);
    expect(out).toContain("  p0,");
    expect(out).not.toContain("...p0");
  });

  it("spreads only array modules; header + p0..pN ids + trailing newline", async () => {
    await writeFixture("arr.js", "export default [{ id: 'x' }];");
    await writeFixture("obj.js", "export default { id: 'y' };");
    const out = await generateIndex(dir);
    expect(out.startsWith("// Auto-generated: static imports of all registry entries\n")).toBe(true);
    expect(out).toContain("import p0 from \"./arr.js\";");
    expect(out).toContain("import p1 from \"./obj.js\";");
    expect(out).toMatch(/export default \[\n  \.\.\.p0,\n  p1,\n\];\n$/);
  });

  it("generated output is byte-identical across runs (idempotent)", async () => {
    await writeFixture("b.js", "export default { id: 'b' };");
    await writeFixture("a.js", "export default [{ id: 'a' }];");
    expect(await generateIndex(dir)).toBe(await generateIndex(dir));
  });

  it("--check clean exits 0 and writes nothing", async () => {
    await writeFixture("m.js", "export default { id: 'm' };");
    const indexPath = path.join(dir, "index.js");
    await writeFile(indexPath, await generateIndex(dir), "utf8");
    const result = await main({ dir, indexPath, check: true });
    expect(result.exitCode).toBe(0);
    expect(result.dirty).toBe(false);
  });

  it("--check dirty exits 1 when committed file drifts", async () => {
    await writeFixture("m.js", "export default { id: 'm' };");
    const indexPath = path.join(dir, "index.js");
    await writeFile(indexPath, "// stale\n", "utf8");
    const result = await main({ dir, indexPath, check: true });
    expect(result.exitCode).toBe(1);
    expect(result.dirty).toBe(true);
  });

  it("write mode emits the barrel and a follow-up --check is clean", async () => {
    await writeFixture("m.js", "export default { id: 'm' };");
    const indexPath = path.join(dir, "index.js");
    const wrote = await main({ dir, indexPath, check: false });
    expect(wrote.exitCode).toBe(0);
    const verify = await main({ dir, indexPath, check: true });
    expect(verify.exitCode).toBe(0);
  });
});
