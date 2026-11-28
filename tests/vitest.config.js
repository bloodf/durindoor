import { defineConfig } from "vitest/config";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { globSync, readFileSync } from "fs";
import { createRequire } from "module";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(resolve(__dirname, "package.json"));
// Vite is a peer dependency nested under Vitest in the tests package. Resolving
// from Vitest keeps the config working when the shared root Vite link is stale.
const vitePackage = require.resolve("vite", { paths: [dirname(require.resolve("vitest/package.json"))] });
const { transformWithOxc } = await import(vitePackage);

// The Cloudflare Workers cloud handler lives in a separate deployment (cloud/),
// which is not part of this repo checkout. Skip its test when absent so the
// suite doesn't fail at collection with ERR_MODULE_NOT_FOUND.
const hasCloud = existsSync(resolve(__dirname, "../cloud"));

// tests/ and the repo root both install playwright (storybook e2e vs browserPool).
// Pin every "playwright" import to the root copy that production code resolves, so
// vi.mock("playwright") in a test hits the module open-sse actually imports.
const playwrightDir = dirname(createRequire(resolve(__dirname, "../package.json")).resolve("playwright/package.json"));

// Project split (#2300): a test is `integration` when its source opens a real
// database, a temp data dir, a process/worker, or a socket; else `unit`. Both
// projects extend this config (vitest concatenates include/exclude arrays), so
// each keeps the root include/exclude and excludes the other's files. The scan
// covers every *.test.js the root include can match, so the split is disjoint.
const INTEGRATION_SOURCE = /DATA_DIR|mkdtemp|child_process|\bWorker\b|createServer|\.listen\s*\(|sqlite|pglite|sql\.js|sqljs/i;
const scanned = globSync("**/*.test.js", { cwd: __dirname, exclude: ["**/node_modules/**", "**/.omc/**", "**/.claude/**"] }).sort();
const integrationFiles = scanned.filter(file => INTEGRATION_SOURCE.test(readFileSync(resolve(__dirname, file), "utf8")));
const integrationSet = new Set(integrationFiles);
const unitFiles = scanned.filter(file => !integrationSet.has(file));

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
    // Number formatting assertions (`2,402 results`, `1.0k`) assume the en-US
    // locale; pin it so a pt-BR or de-DE host does not fail them.
    env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    // Node 25+ enables the global Web Storage API; without --localstorage-file
    // its `localStorage` getter is undefined and shadows the DOM environment's
    // window.localStorage. Disable it where the flag exists (not on Node 20).
    execArgv: process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
      ? ["--no-experimental-webstorage"]
      : [],
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
    // Cap concurrent vitest workers. Vitest defaults to (cpus-1) forked
    // workers (16-CPU host -> 15 here); at that concurrency SQLite/PGlite
    // lock contention across the ~2789 suites (worst offender:
    // quota-reservation-concurrency, which itself fans out 100 concurrent
    // SQLite writer threads) produces intermittent hook timeouts and
    // literal `database is locked` errors, making the gate non-
    // deterministic — a different subset fails each run on the same tree.
    // Do not remove this cap without re-proving determinism at the
    // unbounded default; see history for the reproduction.
    maxWorkers: 4,
    // On the shared CI host, three four-worker trials with 20 extra unit files
    // reached 7.7s per test and 12.4s per hook in the 1131 attribution/capture
    // tests. Allow headroom for contention from other projects on the host.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Suppress noisy console output from handlers under test
    silent: false,
    projects: [
      { extends: true, test: { name: "unit", exclude: integrationFiles } },
      { extends: true, test: { name: "integration", exclude: unitFiles } },
    ],
  },
  plugins: [{
    name: "dashboard-jsx",
    enforce: "pre",
    transform(code, id) {
      if (!id.startsWith(resolve(__dirname, "../src") + "/") || !id.endsWith(".js")) return null;
      return transformWithOxc(code, id, { lang: "jsx", jsx: { runtime: "automatic" } });
    },
  }],
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^playwright$/, replacement: resolve(playwrightDir, "index.mjs") },
      { find: "jsonc-parser", replacement: resolve(__dirname, "node_modules/jsonc-parser/lib/umd/main.js") },
      // Mirrors website/next.config.mjs, so website components under test
      // resolve their own sources the same way the app builds them.
      { find: /^@site\//, replacement: resolve(__dirname, "../website/src") + "/" },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
