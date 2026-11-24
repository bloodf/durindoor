import { join } from "node:path";
import { availableParallelism } from "node:os";
import { createMDX } from "fumadocs-mdx/next";
import { resolveAliases, repoRoot, siteRoot } from "./aliases.mjs";

// Installed fumadocs-mdx defaults configPath to source.config.ts
// (dist/core-BHawVsTm.js). This app is JavaScript, so the file is .mjs.
const withMDX = createMDX({
  configPath: "source.config.mjs",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The demo re-uses the real dashboard UI from ../src. Everything resolves
  // from website/node_modules so there is exactly one React instance.
  experimental: {
    // Honor Next's CI CPU budget as well as affinity, leaving at least one worker.
    cpus: Math.max(1, Math.min(availableParallelism(), Number(process.env.CIRCLE_NODE_TOTAL) || Infinity) - 1),
    externalDir: true,
  },
  outputFileTracingRoot: repoRoot,
  images: { unoptimized: true },
  webpack: (config, { isServer, webpack }) => {
    config.resolve.modules = [join(siteRoot, "node_modules"), "node_modules"];
    config.resolve.alias = {
      ...config.resolve.alias,
      ...resolveAliases(),
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

export default withMDX(nextConfig);
