import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";

const IMAGE_EXTENSIONS = new Set([".svg", ".png", ".webp", ".jpg", ".jpeg", ".avif", ".ico"]);

/** Replace the generated brand directory with runtime images only. */
export async function copyPublicBrand(source, target) {
  const entries = await readdir(source, { withFileTypes: true });
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    await cp(join(source, entry.name), join(target, entry.name));
  }
}
