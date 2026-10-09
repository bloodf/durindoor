#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { verifyStaticAssets } from "./verify-static-assets.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

// Reject links into the checkout, installed runtime caches, or sibling packages.
// Internal links remain internal after relocation; nothing is repaired or installed.
export function validateArtifact(entry) {
  const resolved = fs.realpathSync(entry);
  if (path.basename(resolved) !== "custom-server.js" || !fs.statSync(resolved).isFile()) {
    throw new Error("Pass the artifact's actual custom-server.js executable (standalone or npm app/custom-server.js)");
  }
  const root = path.dirname(resolved);
  const visit = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) {
        if (!inside(root, fs.realpathSync(file)) || path.isAbsolute(fs.readlinkSync(file))) {
          throw new Error(`Artifact contains an external or absolute symlink: ${file}`);
        }
      } else if (item.isDirectory()) visit(file);
    }
  };
  visit(root);
  return root;
}

export function isolatedEnv(home, data, port) {
  return {
    PATH: path.dirname(process.execPath), HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, "config"), XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"), APPDATA: home, LOCALAPPDATA: home,
    TMPDIR: home, TMP: home, TEMP: home,
    NODE_ENV: "production", NODE_PATH: "", NODE_OPTIONS: "",
    HOSTNAME: "127.0.0.1", PORT: String(port), DATA_DIR: data,
    INITIAL_PASSWORD: randomBytes(24).toString("hex"),
    JWT_SECRET: randomBytes(32).toString("hex"), API_KEY_SECRET: randomBytes(32).toString("hex"),
    AUTH_COOKIE_SECURE: "false", NEXT_TELEMETRY_DISABLED: "1",
    DURINDOOR_BROWSER_AUTO_INSTALL: "0", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"),
  };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(base, route, options = {}) {
  return fetch(new URL(route, base), {
    ...options, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
}

async function json(response, status, label) {
  if (response.status !== status || !/application\/json/i.test(response.headers.get("content-type") || "")) {
    throw new Error(`${label}: expected JSON HTTP ${status}, got ${response.status}`);
  }
  return response.json();
}

export async function verifyEndpoints(base, password) {
  const health = await json(await request(base, "/api/health"), 200, "health");
  if (health.ok !== true) throw new Error("health: missing ok:true");
  const login = (value) => request(base, "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ password: value }),
  });
  const denied = await login(password + "-wrong");
  await json(denied, 401, "wrong password");
  if (/auth_token=/.test(denied.headers.get("set-cookie") || "")) throw new Error("Wrong password issued a session");
  const accepted = await login(password);
  const auth = await json(accepted, 200, "correct password");
  const cookie = accepted.headers.getSetCookie().find((value) => value.startsWith("auth_token="))?.split(";")[0];
  if (auth.success !== true || auth.mustChangePassword !== false || !cookie || cookie === "auth_token=") {
    throw new Error("Correct password did not issue a dashboard session");
  }
  const headers = { Cookie: cookie };
  // Only mutate the disposable DATA_DIR through an authenticated settings request.
  // Loopback otherwise bypasses provider and dashboard auth when requireLogin=false.
  const settings = await json(await request(base, "/api/settings", {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ requireLogin: true }),
  }), 200, "enable login requirement");
  if (settings.requireLogin !== true) throw new Error("Settings did not enable requireLogin");
  for (const [label, deniedHeaders] of [
    ["no cookie", {}], ["invalid cookie", { Cookie: "auth_token=invalid-session" }],
  ]) {
    const denial = await json(await request(base, "/api/providers", { headers: deniedHeaders }), 401, `${label} providers`);
    if (denial.error !== "Unauthorized") throw new Error(`${label} providers: missing Unauthorized denial`);
    const page = await request(base, "/dashboard", { headers: deniedHeaders });
    const location = page.headers.get("location");
    await page.body?.cancel();
    if (page.status !== 307 || !location) throw new Error(`${label} dashboard: expected HTTP 307 login redirect, got ${page.status}`);
    const target = new URL(location, base);
    if (target.origin !== new URL(base).origin || target.pathname !== "/login" || target.username || target.password) {
      throw new Error(`${label} dashboard: expected same-origin /login redirect`);
    }
  }
  // Positive protected-route proof comes only after both negative session checks.
  const providers = await json(await request(base, "/api/providers", { headers }), 200, "provider discovery");
  if (!Array.isArray(providers.connections) || providers.connections.length !== 0) {
    throw new Error("Provider discovery must return an empty connections array in isolated DATA_DIR");
  }
  // Next redirects /dashboard to /dashboard/usage. Follow at most five hops,
  // keeping the session on this origin and within non-login dashboard routes.
  let url = new URL("/dashboard", base);
  const visited = new Set([url.href]);
  for (let hops = 0; ; hops++) {
    const page = await request(base, url, { headers });
    if ([301, 302, 303, 307, 308].includes(page.status)) {
      const location = page.headers.get("location");
      await page.body?.cancel();
      if (!location) throw new Error("Dashboard: redirect missing Location");
      if (hops === 5) throw new Error("Dashboard: redirect limit exceeded");
      const next = new URL(location, url);
      const pathname = decodeURIComponent(next.pathname);
      if (next.origin !== url.origin || next.username || next.password ||
          !/^\/dashboard(?:\/|$)/.test(pathname) ||
          /(?:^|\/)login(?:\/|$)/i.test(pathname) || pathname.includes("\\")) {
        throw new Error("Dashboard: unsafe redirect outside authenticated dashboard routes");
      }
      next.hash = "";
      if (visited.has(next.href)) throw new Error("Dashboard: redirect cycle");
      visited.add(next.href);
      url = next;
      continue;
    }
    if (page.status !== 200 || !/text\/html/i.test(page.headers.get("content-type") || "")) {
      throw new Error(`Dashboard: expected HTML HTTP 200, got ${page.status}`);
    }
    return verifyStaticAssets(base, await page.text(), headers);
  }
}

// Runs in the relocated artifact, not the repository's module graph. The close
// operation starts the real PG worker and loads pg without opening a database.
const runtimeProbe = `
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const local = (file) => {
  let real;
  try {
    real = fs.realpathSync(file);
  } catch (cause) {
    // realpath may report only a missing ancestor; retain the requested runtime path.
    throw new Error('Cannot resolve packaged runtime: ' + JSON.stringify(path.relative(root, file)), { cause });
  }
  if (!real.startsWith(root + path.sep)) throw new Error('Runtime resolved outside artifact: ' + real);
  return real;
};
const workerPath = local(path.join(root, 'src/lib/db/adapters/pgSyncWorker.cjs'));
const workerRequire = createRequire(workerPath);
local(workerRequire.resolve('pg'));
local(workerRequire.resolve('pg-query-stream'));
// Instantiate without submitting: this loads pg-cursor and its dependency closure without a DB.
const QueryStream = workerRequire('pg-query-stream');
const stream = new QueryStream('SELECT 1');
if (typeof stream.read !== 'function' || typeof stream.submit !== 'function') throw new Error('Invalid pg-query-stream runtime');
const browserRequire = createRequire(path.join(root, 'open-sse/services/browserPool.js'));
local(browserRequire.resolve('./browserPool.js'));
// Match browserPool's ESM export condition; require.resolve selects the CJS entry.
local(fileURLToPath(import.meta.resolve('playwright')));
const playwright = await import('playwright');
if (typeof playwright.chromium?.launch !== 'function') throw new Error('Invalid playwright runtime');
const sab = new SharedArrayBuffer(4096);
const state = new Int32Array(sab, 0, 2);
const worker = new Worker(workerPath, { workerData: { sab }, execArgv: ['--no-global-search-paths', '--require', process.execArgv[process.execArgv.indexOf('--require') + 1]] });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(new Error('pgSyncWorker close timed out')); }, 10000);
    const poll = setInterval(() => {
      if (Atomics.load(state, 0) !== 0) {
        clearTimeout(timer); clearInterval(poll);
        const reply = JSON.parse(Buffer.from(sab, 8, Atomics.load(state, 1)).toString());
        if (Atomics.load(state, 0) !== 1 || reply.ok !== true) reject(new Error('pgSyncWorker close failed'));
        else resolve();
      }
    }, 20);
    worker.once('error', (error) => { clearTimeout(timer); clearInterval(poll); reject(error); });
    worker.once('exit', (code) => { clearTimeout(timer); clearInterval(poll); reject(new Error('pgSyncWorker exited: ' + code)); });
    worker.postMessage({ op: 'close' });
  });
} finally { await worker.terminate(); }
console.log('Optional runtime loading OK: pgSyncWorker, pg, pg-query-stream/pg-cursor, dynamic playwright');
`;

export async function smokeInstalledArtifact(entry) {
  const source = validateArtifact(entry);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-installed-smoke-"));
  const root = path.join(temp, "artifact");
  const home = path.join(temp, "home");
  let child;
  let exited;
  const signalHandlers = new Map();
  try {
    // ESM resolution also walks ancestor node_modules (it ignores NODE_PATH).
    for (let dir = temp; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "node_modules"))) {
        throw new Error(`Isolation requires no ancestor node_modules: ${dir}`);
      }
      if (path.dirname(dir) === dir) break;
    }
    fs.cpSync(source, root, { recursive: true, verbatimSymlinks: true });
    fs.mkdirSync(home);
    const port = await freePort();
    const env = isolatedEnv(home, path.join(temp, "data"), port);
    // Node's ancestor/global CJS lookup must never mask missing packaged deps.
    const guard = path.join(temp, "resolution-guard.cjs");
    fs.writeFileSync(guard, `const M = require('node:module'); const fs = require('node:fs'); const path = require('node:path');\nconst original = M._resolveFilename;\nM._resolveFilename = function(...args) { const file = original.apply(this, args); if (path.isAbsolute(file) && !fs.realpathSync(file).startsWith(${JSON.stringify(root + path.sep)})) throw new Error('Dependency outside artifact: ' + file); return file; };\n`);
    const launch = (args) => {
      child = spawn(process.execPath, ["--no-global-search-paths", "--require", guard, ...args], {
        cwd: root, env, stdio: ["ignore", "inherit", "inherit"],
      });
      exited = new Promise((resolve) => {
        child.once("error", (error) => resolve({ error }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => child?.kill("SIGTERM");
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    launch(["--input-type=module", "--eval", runtimeProbe]);
    const probe = await exited;
    if (probe.error || probe.code !== 0) throw new Error(`Optional runtime probe failed: ${probe.error?.message || probe.signal || probe.code}`);
    launch([path.join(root, "custom-server.js")]);
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) throw new Error("Artifact server exited before readiness");
      try {
        const health = await request(base, "/api/health");
        if (health.status === 200) { ready = true; break; }
      } catch { /* Wait only for startup; endpoint validation below is strict. */ }
      await sleep(200);
    }
    if (!ready) throw new Error("Artifact server readiness timed out");
    const count = await verifyEndpoints(base, env.INITIAL_PASSWORD);
    console.log(`Installed artifact smoke OK: health, wrong/right auth, no-cookie/invalid-cookie denials, authenticated provider discovery, ${count} static assets`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    }
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/smoke-installed-artifact.mjs /absolute/artifact/custom-server.js");
    process.exitCode = 1;
  } else {
    smokeInstalledArtifact(process.argv[2]).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
