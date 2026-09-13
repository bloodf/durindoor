import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const siteRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(siteRoot, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The demo re-uses the real dashboard UI from ../src. Everything resolves
  // from website/node_modules so there is exactly one React instance.
  experimental: { externalDir: true },
  outputFileTracingRoot: repoRoot,
  images: { unoptimized: true },
  webpack: (config, { isServer, webpack }) => {
    config.resolve.modules = [join(siteRoot, "node_modules"), "node_modules"];
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": join(repoRoot, "src"),
      "open-sse": join(repoRoot, "open-sse"),
      "@site": join(siteRoot, "src"),
    };
    // open-sse/utils/kimchiUserAgent.js polls GitHub on server import; swap in a static stub.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/open-sse[\\/]utils[\\/]kimchiUserAgent\.js$/, join(siteRoot, "src/mock/server/kimchiUserAgent.js")),
    );
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, crypto: false, dns: false, url: false };
    }
    return config;
  },
};

export default nextConfig;
