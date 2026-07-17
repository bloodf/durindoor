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

    // Next's standalone trace includes the server bundle but (with this repo's
    // custom distDir/outputFileTracingRoot setup) does NOT copy the client static
    // chunks or public files into the standalone root. Without them, the running
    // server 404s on hashed .js/.css and favicons. Copy fresh on every build so
    // the deployed directory always matches the just-built output.
    const nextStaticSource = path.join(process.cwd(), distDir, "static");
    const nextStaticDest = path.join(standaloneDir, distDir, "static");
    if (fs.existsSync(nextStaticDest)) {
      fs.rmSync(nextStaticDest, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(nextStaticDest), { recursive: true });
    fs.cpSync(nextStaticSource, nextStaticDest, { recursive: true, dereference: true });

    const publicSource = path.join(process.cwd(), "public");
    const publicDest = path.join(standaloneDir, "public");
    if (fs.existsSync(publicDest)) {
      fs.rmSync(publicDest, { recursive: true, force: true });
    }
    if (fs.existsSync(publicSource)) {
      fs.cpSync(publicSource, publicDest, { recursive: true, dereference: true });
    }

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
    // Runtime server code imports from `open-sse/*` via bare aliases that
    // Next's NFT does not fully trace. The Dockerfile already repairs this by
    // copying the whole open-sse tree; do the same for standalone builds from
    // source so `npm run build && npm start` does not 500 on missing modules.
    const openSseSource = path.join(process.cwd(), "open-sse");
    const openSseDest = path.join(standaloneDir, "open-sse");
    if (fs.existsSync(openSseDest)) {
      fs.rmSync(openSseDest, { recursive: true, force: true });
    }
    fs.cpSync(openSseSource, openSseDest, { recursive: true, dereference: true });
    // OmniRoute #6828: custom-server.js requires this at its first line to strip
    // empty-string env vars before app modules snapshot them.
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "normalizeEnv.js"),
      path.join(standaloneDir, "src", "shared", "utils", "normalizeEnv.js"),
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
