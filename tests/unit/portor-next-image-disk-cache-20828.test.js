// OmniRoute #20828 (issue #20818): /_next/image must not start a disk cache under
// <distDir>/cache on a read-only install tree. images.maximumDiskCacheSize: 0 is
// Next's switch; images are unoptimized so the cache is never used.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..", "..");

function unwritableDistDir() {
  const dir = mkdtempSync(join(tmpdir(), "durindoor-20828-"));
  const installTree = join(dir, "dist");
  writeFileSync(installTree, "not a directory");
  return { dir, distDir: join(installTree, ".build", "next") };
}

describe("next image disk cache (#20828)", () => {
  it("disables the image disk cache alongside unoptimized images", async () => {
    const { default: nextConfig } = await import(join(root, "next.config.mjs"));
    expect(nextConfig.images.unoptimized).toBe(true);
    expect(nextConfig.images.maximumDiskCacheSize).toBe(0);
  });

  it("an image request never touches <distDir>/cache with DurinDoor's image config", async () => {
    const { default: nextConfig } = await import(join(root, "next.config.mjs"));
    const { ImageOptimizerCache } = require(require.resolve("next/dist/server/image-optimizer", { paths: [root] }));
    const { resetDiskLRU } = require(require.resolve("next/dist/server/lib/disk-lru-cache.external", { paths: [root] }));
    const { imageConfigDefault } = require(require.resolve("next/dist/shared/lib/image-config", { paths: [root] }));
    const { dir, distDir } = unwritableDistDir();
    resetDiskLRU();
    try {
      const cache = new ImageOptimizerCache({
        distDir,
        nextConfig: { images: { ...imageConfigDefault, ...nextConfig.images }, experimental: { isrFlushToDisk: true } },
      });
      expect(cache.isDiskCacheEnabled).not.toBe(true);
      expect(cache.cacheDiskLRU).toBeUndefined();
      expect(existsSync(join(dir, "dist", ".build"))).toBe(false);
    } finally {
      resetDiskLRU();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
