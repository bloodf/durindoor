#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Shared by the build-tree check and the relocated installed-artifact check.
export async function verifyStaticAssets(baseUrl, pageHtml, headers = {}) {
  const urls = new Set();
  const pattern = /(?:src|href)="(\/(?!\/)[^"?#]+\.(?:js|css|ico|webmanifest|woff2|svg|png)(?:[?#][^"]*)?)"/g;
  for (const match of pageHtml.matchAll(pattern)) urls.add(match[1]);
  if (![...urls].some((url) => /\.(js|css)(?:[?#]|$)/.test(url))) {
    throw new Error("No local .js/.css assets found in page HTML");
  }
  for (const url of urls) {
    const response = await fetch(new URL(url, baseUrl), {
      headers, redirect: "manual", signal: AbortSignal.timeout(10000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get("content-type") || "";
    if (response.status !== 200 || !body.length || /text\/html/i.test(type) ||
        /^\s*(?:<!doctype\s+html|<html\b)/i.test(body.toString("utf8", 0, 512))) {
      throw new Error(`Asset ${url}: HTTP ${response.status}, ${type || "no content type"}, ${body.length} bytes`);
    }
    if (/\.js(?:[?#]|$)/.test(url) && !/(?:javascript|ecmascript)/i.test(type) ||
        /\.css(?:[?#]|$)/.test(url) && !/^text\/css\b/i.test(type)) {
      throw new Error(`Asset ${url}: unexpected content type ${type}`);
    }
  }
  return urls.size;
}

const DIST_DIR = process.env.NEXT_DIST_DIR || ".next";
const BASE_STANDALONE = path.join(process.cwd(), DIST_DIR, "standalone");

function resolveStandaloneRoot(base) {
  if (fs.existsSync(path.join(base, "custom-server.js"))) return base;
  // workspace tracing mode nests the app under a project subdirectory
  const nested = fs.existsSync(base)
    ? fs.readdirSync(base)
        .map((name) => path.join(base, name))
        .find((dir) => fs.existsSync(path.join(dir, "custom-server.js")))
    : undefined;
  return nested || base;
}

const STANDALONE_ROOT = resolveStandaloneRoot(BASE_STANDALONE);
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
    const count = await verifyStaticAssets(baseUrl, pageHtml);
    console.log(`Static asset smoke OK: ${count} assets, port ${port}`);
  } finally {
    await cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(
  () => process.exit(0),
  (error) => {
    console.error(error?.message || error);
    process.exit(1);
  }
);
