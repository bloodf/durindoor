#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createIsolatedBuildEnvironment } from "./build-environment.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-build-"));

let status = 1;
try {
  const result = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    stdio: "inherit",
    env: createIsolatedBuildEnvironment(process.env, buildRoot),
  });
  if (result.error) throw result.error;
  status = result.status ?? 1;
  if (status === 0) {
    const distDir = process.env.NEXT_DIST_DIR || ".next";
    const standaloneRoot = path.join(process.cwd(), distDir, "standalone");
    const standaloneDir = fs.existsSync(path.join(standaloneRoot, "server.js"))
      ? standaloneRoot
      : fs.readdirSync(standaloneRoot)
        .map((name) => path.join(standaloneRoot, name))
        .find((candidate) => fs.existsSync(path.join(candidate, "server.js")));
    if (!standaloneDir) throw new Error(`Standalone server not found under ${standaloneRoot}`);
    fs.copyFileSync(path.join(process.cwd(), "custom-server.js"), path.join(standaloneDir, "custom-server.js"));
    // custom-server.js requires ./head-response-guard.cjs (OmniRoute #6908):
    // a root-level sidecar outside Next's NFT trace, so it must be copied by
    // hand or the standalone server crashes at boot with MODULE_NOT_FOUND.
    fs.copyFileSync(path.join(process.cwd(), "head-response-guard.cjs"), path.join(standaloneDir, "head-response-guard.cjs"));
    fs.cpSync(path.join(process.cwd(), "src", "mitm"), path.join(standaloneDir, "src", "mitm"), {
      recursive: true,
    });
    // Realtime WebSocket bridge: custom-server.js `require()`s these CJS helpers
    // from bare Node where `@/` / `open-sse/` aliases don't resolve, and NFT
    // does not trace dynamic `require()` paths of a post-build entry. Copy the
    // sources preserving their on-disk relative layout so the `require(...)`
    // specifiers inside custom-server.js still resolve.
    const wsHandshakeDest = path.join(standaloneDir, "src", "shared", "utils", "wsHandshake.js");
    fs.mkdirSync(path.dirname(wsHandshakeDest), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "wsHandshake.js"),
      wsHandshakeDest,
    );
    // Realtime resource limits (CJS source of truth) — required at import time
    // by both custom-server.js (maxPayload) and realtimeCore.js (item cap).
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "realtimeConfig.js"),
      path.join(standaloneDir, "src", "shared", "utils", "realtimeConfig.js"),
    );
    fs.mkdirSync(path.join(standaloneDir, "open-sse", "handlers"), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "open-sse", "handlers", "realtimeCore.js"),
      path.join(standaloneDir, "open-sse", "handlers", "realtimeCore.js"),
    );
    // Ensure `require("ws")` resolves inside the standalone bundle. Next's NFT
    // typically already traces ws (server-side fetch/WS deps), but a post-build
    // entry is outside the trace — copy the resolved package if it is missing
    // so the built entry can boot on a clean machine.
    const standaloneWs = path.join(standaloneDir, "node_modules", "ws");
    if (!fs.existsSync(standaloneWs)) {
      const wsRoot = path.dirname(require.resolve("ws/package.json"));
      fs.cpSync(wsRoot, standaloneWs, { recursive: true });
    }
    const sharedConstantsDir = path.join(standaloneDir, "src", "shared", "constants");
    fs.mkdirSync(sharedConstantsDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "constants", "processExitCodes.js"),
      path.join(sharedConstantsDir, "processExitCodes.js"),
    );
  }
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}

process.exit(status);
