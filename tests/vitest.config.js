import { defineConfig } from "vitest/config";
import { transformWithOxc } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// The Cloudflare Workers cloud handler lives in a separate deployment (cloud/),
// which is not part of this repo checkout. Skip its test when absent so the
// suite doesn't fail at collection with ERR_MODULE_NOT_FOUND.
const hasCloud = existsSync(resolve(__dirname, "../cloud"));

export default defineConfig({
  oxc: {
    include: /(?:src\/app\/\(dashboard\)\/dashboard\/providers\/\[id\]\/EditCompatibleNodeModal\.js|\.jsx)$/,
    exclude: [],
    lang: "jsx",
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .omc/ or .claude/ — they carry
    // their own copies of the test files but lack an installed node_modules
    // (open-sse, etc.), which makes provider imports fail during collection.
    // *.live.test.js are live smoke tests hitting real upstreams (network +
    // real accounts); they are excluded from the default/CI run — run them
    // explicitly when needed.
    exclude: [
      "**/node_modules/**",
      "**/.omc/**",
      "**/.claude/**",
      /** omp-extension owns a Bun suite whose TypeScript SDK imports are not Node/Vitest inputs. */
      "**/omp-extension/**",
      "**/dist/**",
      "**/*.live.test.js",
      ...(hasCloud ? [] : ["**/embeddings.cloud.test.js"]),
    ],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Full-suite runs contend on shared SQLite fixtures; observed worst-case
    // per-test wall time under contention is ~9.4s, which flakes against the
    // Vitest 5s default. Set an explicit ceiling with headroom so slow-but-real
    // hangs still fail while contention-bound tests pass deterministically.
    testTimeout: 15_000,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  plugins: [{
    name: "dashboard-jsx",
    enforce: "pre",
    transform(code, id) {
      if (!/\/src\/.*\.js$/.test(id)) return null;
      return transformWithOxc(code, id, { lang: "jsx", jsx: { runtime: "automatic" } });
    },
  }],
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: "jsonc-parser", replacement: resolve(__dirname, "node_modules/jsonc-parser/lib/umd/main.js") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
