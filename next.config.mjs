import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { availableParallelism } from "node:os";
import { resolveTracingRoot } from "./tracing-root.mjs";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = resolveTracingRoot(projectRoot, process.env.NEXT_TRACING_ROOT_MODE);
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: process.env.DURINDOOR_BASE_PATH || "",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // Isolated provider paths retain upstream slash semantics; src/proxy.js
  // keeps the default no-trailing-slash redirect on ordinary application hosts.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "pg", "playwright", "playwright-core", "tls-client-node", "wreq-js", "puppeteer", "puppeteer-extra", "puppeteer-extra-plugin-stealth"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/lib/db/adapters/pgSyncWorker.cjs"],
    "/*": ["./src/lib/db/adapters/pgSyncWorker.cjs"],
  },
  images: {
    unoptimized: true,
    // OmniRoute #20818: Next builds an ImageOptimizerCache for every /_next/image request
    // before it checks `unoptimized`, and that constructor starts a disk LRU that mkdirs
    // <distDir>/cache/images. On a global npm install served by an account that cannot write
    // the install tree (systemd ProtectSystem=full) that mkdir fails. With unoptimized images
    // the disk cache is never read or written, so 0 turns it off.
    maximumDiskCacheSize: 0
  },
  env: { NEXT_PUBLIC_BASE_PATH: process.env.DURINDOOR_BASE_PATH || "" },
  experimental: {
    // Honor Next's CI CPU budget as well as affinity, leaving at least one worker.
    cpus: Math.max(1, Math.min(availableParallelism(), Number(process.env.CIRCLE_NODE_TOTAL) || Infinity) - 1),
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
    // Cache fetch responses across HMR refreshes for faster dev reloads.
    serverComponentsHmrCache: true,
    // Tree-shake heavy barrel imports to cut compile + bundle size
    optimizePackageImports: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable", "material-symbols", "marked"],
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // better-sqlite3 is an OPTIONAL native dep. On hosts without a C++ toolchain
    // (e.g. Hostinger Node hosting) its native build is skipped and the module is
    // absent — serverExternalPackages then can't externalize it (it resolves the
    // package first) and webpack fails with "Can't resolve 'better-sqlite3'".
    // Force-externalize so webpack never resolves it at build; driver.js catches the
    // missing require at runtime and falls back to node:sqlite (Node >=22.5) / sql.js.
    // wreq-js (optional, OpenCode TLS transport) is handled the same way: a missing
    // module falls back to native fetch in open-sse/services/opencodeTlsClient.js.
    if (isServer) {
      const prev = config.externals;
      config.externals = [
        ({ request }, cb) => (
          request === "better-sqlite3" || request === "pg" || request === "wreq-js"
            || request === "puppeteer" || request === "puppeteer-extra" || request === "puppeteer-extra-plugin-stealth"
            ? cb(null, `commonjs ${request}`)
            : cb()
        ),
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
    }
    // Exclude non-source dirs from watcher to reduce inotify load
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|\.next-cli-build|cli|open-sse\.old|tests|docs)[\\/]/,
    };
    return config;
  },
  // #2251: baseline clickjacking / MIME / referrer / embedding CSP on every response.
  // Omits script-src/style-src — Next inline runtime scripts would break; nonce CSP is out of scope.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/responses",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1beta/:path*",
        destination: "/api/v1beta/:path*"
      },
      {
        source: "/v1beta",
        destination: "/api/v1beta"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
