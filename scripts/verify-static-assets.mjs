#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DIST_DIR = process.env.NEXT_DIST_DIR || ".next";
const STANDALONE_ROOT = path.join(process.cwd(), DIST_DIR, "standalone");
const SERVER_ENTRY = path.join(STANDALONE_ROOT, "custom-server.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url, { timeoutMs = 30000, child } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.status < 500) return response.status;
    } catch {
      // server not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Server did not respond within ${timeoutMs}ms`);
}

async function main() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(`Standalone server not found at ${SERVER_ENTRY}. Run "npm run build" first.`);
  }

  const port = await findFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-smoke-data-"));
  let child = null;
  let cleanupPromise = null;

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5000);
        await new Promise((resolve) => child.once("exit", resolve)).finally(() => clearTimeout(timer));
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    })();
    return cleanupPromise;
  }

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => cleanup().then(() => process.exit(1)));
  }

  try {
    const env = {
      ...process.env,
      NODE_OPTIONS: "",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      JWT_SECRET: "smoke-jwt-secret-do-not-reuse",
      API_KEY_SECRET: "smoke-api-key-secret-do-not-reuse",
    };

    child = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      stdio: ["ignore", "inherit", "inherit"],
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const pageUrl = `${baseUrl}/dashboard`;
    const pageStatus = await waitForUrl(pageUrl, { child });
    if (pageStatus !== 200) {
      throw new Error(`Page ${pageUrl} returned ${pageStatus}`);
    }

    const pageHtml = await fetch(pageUrl, { redirect: "follow" }).then((r) => r.text());
    const requiredUrls = new Set();
    const extraUrls = new Set();
    const requiredPattern = /(?:src|href)="(\/[^"?#]+\.(?:js|css)(?:[?#][^"]*)?)"/g;
    const extraPattern = /(?:src|href)="(\/[^"?#]+\.(?:ico|webmanifest|woff2|svg|png)(?:[?#][^"]*)?)"/g;
    let match;
    while ((match = requiredPattern.exec(pageHtml)) !== null) {
      requiredUrls.add(match[1]);
    }
    while ((match = extraPattern.exec(pageHtml)) !== null) {
      extraUrls.add(match[1]);
    }

    if (!requiredUrls.size) {
      throw new Error("No local .js/.css assets found in page HTML");
    }

    const assetUrls = new Set([...requiredUrls, ...extraUrls]);
    const failures = [];
    for (const url of assetUrls) {
      const response = await fetch(`${baseUrl}${url}`);
      if (response.status !== 200) {
        failures.push(`${url} -> ${response.status}`);
      } else {
        console.log(`  OK ${url}`);
      }
    }

    if (failures.length) {
      throw new Error(`Asset failures:\n${failures.join("\n")}`);
    }

    console.log(`Static asset smoke OK: ${requiredUrls.size} required JS/CSS, ${extraUrls.size} extra assets, port ${port}`);
  } finally {
    await cleanup();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error?.message || error);
    process.exit(1);
  }
);
