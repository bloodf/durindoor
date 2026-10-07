import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { copyPublicBrand } from "../../website/scripts/sync-brand-public.mjs";

it("publishes images while removing internal notes and stale copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "durindoor-brand-"));
  try {
    const source = join(root, "source");
    const target = join(root, "public");
    await mkdir(source); await mkdir(target);
    await writeFile(join(source, "logo.svg"), "<svg />");
    await writeFile(join(source, "gateway.webp"), "image");
    await writeFile(join(source, "README.md"), "internal maintenance");
    await writeFile(join(source, "prompts.md"), "internal prompts");
    await writeFile(join(source, "vector-kit.zip"), "archive");
    await writeFile(join(target, "prompts.md"), "stale public prompt");
    await copyPublicBrand(source, target);
    expect((await readdir(target)).sort()).toEqual(["gateway.webp", "logo.svg"]);
    expect(await readFile(join(target, "logo.svg"), "utf8")).toBe("<svg />");
    await copyPublicBrand(source, target);
    expect((await readdir(target)).sort()).toEqual(["gateway.webp", "logo.svg"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
