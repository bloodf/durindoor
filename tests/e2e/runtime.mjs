import { createServer } from "node:http";
import { createConnection } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { closeProcess } from "./process.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNS_ROOT = path.join(ROOT, "qa/runs");
const SEED_CLI = path.join(ROOT, "tests/e2e/seeds.mjs");
const SEED_MARKER = ".durindoor-ui-qa-manifest.json";
export const AUTHORITY_KIND = "durindoor-ui-qa-authority";
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const PROBE_TARGETS = Object.freeze([
  { label: "deny-public-origin", host: "1.1.1.1", port: 443, kind: "network" },
  { label: "deny-instance-metadata", host: "169.254.169.254", port: 80, kind: "network" },
  { label: "deny-host-gateway", host: "172.17.0.1", port: 80, kind: "network" },
  { label: "fake-positive-control", host: process.env.DURIN_QA_FAKE_UPSTREAM_HOST || "fake-upstream", port: Number(process.env.DURIN_QA_FAKE_UPSTREAM_PORT) || 4100, kind: "control" }
]);
const PROBE_TIMEOUT_MS = 2_000;

function fail(message) { throw new Error(`[ui-qa] ${message}`); }
function redactSecrets(text) { return text.replace(/(INITIAL_PASSWORD|JWT_SECRET|token|cookie|password)=([^\s&"']+)/gi, "$1=[redacted]"); }
function boundAppend(buffer, chunk, max = 8_192) { const next = buffer + chunk.toString("utf8"); return next.length > max ? next.slice(-max) : next; }

async function requireLaunchedByHardenedEntrypoint() {
  if (process.env.DURIN_QA_HARDENED !== "1") fail("refuses to run outside hardened QA container");
  if (process.env.DURIN_QA_DB_HOST || process.env.DATABASE_URL || process.env.DOCKER_HOST) fail("refuses host database or Docker configuration");
  const manifestPath = process.env.DURIN_QA_AUTHORITY_MANIFEST;
  if (!manifestPath) fail("DURIN_QA_AUTHORITY_MANIFEST env var is required");
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")); } catch (error) { fail(`authority manifest unreadable: ${error.message}`); }
  if (parsed?.kind !== AUTHORITY_KIND || parsed.version !== 1 || typeof parsed.createdAt !== "string") fail("authority manifest invalid");
}

function containedPath(candidate, root = RUNS_ROOT) {
  const resolved = path.resolve(candidate);
  const realRoot = path.resolve(root);
  const rel = path.relative(realRoot, resolved);
  if (resolved === realRoot || rel.startsWith("..") || path.isAbsolute(rel)) fail("run directory escapes qa/runs");
  return resolved;
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = ""; let combined = ""; let oversized = false;
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); combined = boundAppend(combined, chunk); if (stdout.length > 1024 * 1024) { oversized = true; proc.kill("SIGTERM"); } });
    proc.stderr.on("data", (chunk) => { combined = boundAppend(combined, chunk); });
    proc.once("error", (error) => reject(new Error(`spawn ${command} failed: ${error.message}`)));
    proc.once("close", (code, signal) => oversized ? reject(new Error("seed CLI output exceeds 1 MiB")) : code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code ?? signal}: ${redactSecrets(combined)}`)));
  });
}

function parseSeedResult(output) {
  const prefix = "DURIN_UI_QA_RESULT ";
  const results = output.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  if (results.length !== 1) fail("seed CLI must emit exactly one result record");
  try { return JSON.parse(results[0].slice(prefix.length)); } catch { fail("seed CLI result is not valid JSON"); }
}

async function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, family: 4 });
    let settled = false;
    const finish = (ok, reason) => { if (settled) return; settled = true; socket.destroy(); resolve({ ok, reason }); };
    const timer = setTimeout(() => finish(false, "timeout"), PROBE_TIMEOUT_MS);
    socket.once("connect", () => { clearTimeout(timer); finish(true, null); });
    socket.once("error", (error) => { clearTimeout(timer); finish(false, error.code || error.message); });
  });
}

/** Real TCP reachability audit of the four fixed control points, run before
 *  the app server starts. Three MUST be unreachable (proves network
 *  isolation); the fake-upstream positive control MUST be reachable (proves
 *  the probe mechanism itself works and isn't a false negative). */
async function auditServerChannels() {
  const results = [];
  for (const target of PROBE_TARGETS) {
    const probe = await tcpProbe(target.host, target.port);
    const isPositiveControl = target.label === "fake-positive-control";
    if (isPositiveControl && !probe.ok) fail(`expected positive control ${target.host}:${target.port} to be reachable but probe failed (${probe.reason})`);
    if (!isPositiveControl && probe.ok) fail(`unexpected network reachability to ${target.host}:${target.port} (container must be isolated)`);
    results.push({ kind: target.kind, label: target.label, ok: probe.ok, detail: { url: `tcp://${target.host}:${target.port}`, reason: probe.reason } });
  }
  return results;
}

async function waitFor(url, proc) {
  const deadline = Date.now() + 20_000;
  const isAuthStatus = url.includes("/api/auth/status");
  while (Date.now() < deadline) {
    if (proc?.qaSpawnError) fail(`server failed to spawn: ${proc.qaSpawnError.message}`);
    if (proc && proc.exitCode !== null) fail(`server exited during readiness (${proc.exitCode})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (isAuthStatus) {
        if (response.status === 200) { try { const payload = await response.json(); if (payload && typeof payload === "object") return; } catch { /* retry bounded readiness */ } }
      } else if (response.status === 200 && (response.headers.get("content-type") || "").includes("text/html")) {
        return;
      }
    } catch { /* retry bounded readiness */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`server readiness timed out: ${url}`);
}

function staticServer(directory) {
  const mime = { ".css": "text/css", ".html": "text/html", ".ico": "image/x-icon", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const root = path.resolve(directory);
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const target = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!target.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
      if (!(await fs.stat(target)).isFile()) return response.writeHead(404).end();
      response.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream", "x-content-type-options": "nosniff" });
      response.end(await fs.readFile(target));
    } catch (error) { response.writeHead(error?.code === "ENOENT" ? 404 : 400).end(); }
  });
}

/**
 * Start a contained QA runtime for exactly one Playwright worker.
 *
 * `runDir` is created fresh here (fails if it already exists) so a reused or
 * colliding nonce from the fixture layer surfaces as a hard error instead of
 * silently reusing another worker's data. `dataDir`/`.durindoor-ui-qa-manifest.json`
 * are the exact fields tests/e2e/seeds.mjs (frozen, owned elsewhere) requires
 * to accept mutation calls against this directory.
 */
export async function startQa({ runDir, workerId, mode }) {
  await requireLaunchedByHardenedEntrypoint();
  if (!Number.isInteger(workerId) && typeof workerId !== "string") fail("workerId is required");
  if (!["app", "storybook"].includes(mode)) fail("mode must be app or storybook");
  await fs.mkdir(RUNS_ROOT, { recursive: true, mode: 0o700 });
  const requestedRunDir = containedPath(runDir);
  try { await fs.mkdir(requestedRunDir, { recursive: false, mode: 0o700 }); }
  catch (error) { if (error?.code === "EEXIST") fail(`run directory already exists (worker nonce reuse refused): ${requestedRunDir}`); throw error; }
  const absoluteRunDir = containedPath(await fs.realpath(requestedRunDir));
  const dataDir = path.join(absoluteRunDir, "data");
  const artifactDir = path.join(absoluteRunDir, "artifacts");
  const homeDir = path.join(absoluteRunDir, "home");
  await Promise.all([fs.mkdir(dataDir, { mode: 0o700 }), fs.mkdir(artifactDir, { mode: 0o700 }), fs.mkdir(homeDir, { mode: 0o700 })]);
  const realDataDir = await fs.realpath(dataDir);
  const realHomeDir = await fs.realpath(homeDir);
  if (!realDataDir.startsWith(`${absoluteRunDir}${path.sep}`) || !realHomeDir.startsWith(`${absoluteRunDir}${path.sep}`)) fail("worker child directories must live under runDir");
  const auditPath = path.join(absoluteRunDir, "audit.jsonl");
  const runLogPath = path.join(absoluteRunDir, "run.log");
  const seedManifest = { kind: "durindoor-ui-qa", version: 1, runId: path.basename(absoluteRunDir), workerId, createdAt: new Date().toISOString(), dataDir: realDataDir, homeDir: realHomeDir };
  await fs.writeFile(path.join(realDataDir, SEED_MARKER), JSON.stringify(seedManifest), { mode: 0o600 });

  const recordEvent = async (event) => fs.appendFile(auditPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  for (const probe of await auditServerChannels()) await recordEvent(probe);

  let password = randomBytes(24).toString("base64url");
  let jwtSecret = randomBytes(32).toString("hex");
  let proc = null; let staticService = null; let port = null; let stopped = false; let mutationChain = Promise.resolve();

  const start = async () => {
    if (stopped) fail("runtime is stopped");
    if (port === null) port = await new Promise((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const n = s.address().port; s.close((error) => error ? reject(error) : resolve(n)); }); });
    if (mode === "storybook") {
      staticService = staticServer(path.join(ROOT, "storybook-static"));
      await new Promise((resolve, reject) => staticService.once("error", reject).listen(port, "127.0.0.1", resolve));
      return waitFor(`http://127.0.0.1:${port}/`, null);
    }
    const allowedEnv = { PATH: process.env.PATH || "", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", HOME: realHomeDir, HOSTNAME: "127.0.0.1", PORT: String(port), DATA_DIR: realDataDir, INITIAL_PASSWORD: password, JWT_SECRET: jwtSecret, DURIN_QA_HARDENED: "1" };
    proc = spawn(process.execPath, [".next/standalone/custom-server.js"], { cwd: ROOT, env: allowedEnv, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => { fs.appendFile(runLogPath, redactSecrets(chunk.toString("utf8")), { mode: 0o600 }).catch(() => process.stderr.write("[ui-qa] run.log append failed\n")); });
    proc.stderr.on("data", (chunk) => { fs.appendFile(runLogPath, redactSecrets(chunk.toString("utf8")), { mode: 0o600 }).catch(() => process.stderr.write("[ui-qa] run.log append failed\n")); });
    proc.once("error", (error) => { proc.qaSpawnError = error; });
    return waitFor(`http://127.0.0.1:${port}/api/auth/status`, proc);
  };

  const stopServer = async () => {
    if (staticService) { const server = staticService; await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); staticService = null; }
    if (proc) { const server = proc; await closeProcess(server); proc = null; }
  };

  const mutate = (args, preserveAuth) => {
    const run = mutationChain.then(async () => {
      if (mode !== "app") fail("storybook runtime does not own fixture data");
      if (!preserveAuth) fail("QA resets preserve the worker session; start a new runtime for fresh authentication");
      await stopServer();
      try { return parseSeedResult(await runChild(process.execPath, [SEED_CLI, "--data-dir", realDataDir, "--expect-manifest", ...args], { cwd: ROOT, env: { PATH: process.env.PATH || "", NODE_ENV: "production", DATA_DIR: realDataDir, DURIN_QA_HARDENED: "1" } })); }
      finally { await start(); }
    });
    mutationChain = run.then(() => {}, () => {});
    return run;
  };

  try { await start(); }
  catch (startError) {
    let cleanupError = null;
    try { await stopServer(); } catch (error) { cleanupError = error; }
    stopped = true;
    throw cleanupError ? new Error(`${startError.message}; cleanup also failed: ${cleanupError.message}`) : startError;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const baseOrigin = new URL(baseUrl).origin;

  return {
    baseUrl, dataDir: realDataDir, artifactDir,
    authenticate: async (page) => {
      if (mode !== "app") fail("storybook runtime has no authentication");
      // Strict fresh-login oracle: H1 verifies and reuses an installed session
      // before delegating here. Start at a protected page, proving this empty
      // context is denied before the password form appears.
      await page.goto(`${baseUrl}/dashboard/usage`, { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => new URL(url).pathname === "/login", { timeout: 10_000 });
      const input = page.locator("#dashboard-password");
      await input.waitFor({ state: "visible", timeout: 10_000 });
      const wrongLogin = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST",
      );
      await input.fill(`${password}-wrong`);
      await page.locator("form button[type=submit]").click();
      const rejected = await wrongLogin;
      if (rejected.status() !== 401) fail(`runtime.authenticate: wrong QA password must return 401 (got ${rejected.status()})`);
      await page.getByText(/Invalid password/i).first().waitFor({ state: "visible", timeout: 10_000 });
      await input.fill("");
      await input.fill(password);
      await Promise.all([
        page.waitForURL((url) => new URL(url).pathname.startsWith("/dashboard"), { timeout: 10_000 }),
        page.locator("form button[type=submit]").click()
      ]);
      return { baseURL: baseUrl, storageState: await page.context().storageState() };
    },
    seed: ({ scenario } = {}) => mutate(["--scenario", scenario], true),
    reset: ({ preserveAuth = true } = {}) => mutate(["--reset"], preserveAuth),
    recordBrowserRequest: async (event) => {
      if (!event || typeof event.label !== "string" || !["control", "network", "navigate"].includes(event.kind) || typeof event.ok !== "boolean") fail("invalid browser audit event");
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (typeof detail.url !== "string") fail("browser audit event missing detail.url");
      let parsed;
      try { parsed = new URL(detail.url); } catch { fail(`browser audit event url is not parseable: ${detail.url}`); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(`browser audit event url is not http(s): ${detail.url}`);
      if (event.label.startsWith("allow-")) { if (parsed.origin !== baseOrigin) fail(`allow label ${event.label} must point at runtime origin ${baseOrigin}, got ${parsed.origin}`); }
      else if (event.label.startsWith("deny-")) { if (parsed.origin === baseOrigin) fail(`deny label ${event.label} must NOT point at runtime origin ${baseOrigin}`); }
      await recordEvent(event);
    },
    assertNoExternalEffects: async () => {
      const events = (await fs.readFile(auditPath, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const byLabel = new Map();
      for (const event of events) { const slot = byLabel.get(event.label) ?? []; slot.push(event); byLabel.set(event.label, slot); }
      const DENY_LABELS = ["deny-public-origin", "deny-instance-metadata", "deny-host-gateway"];
      const ALLOW_LABELS = ["allow-runtime-origin", "fake-positive-control"];
      const missingDenies = DENY_LABELS.filter((label) => !byLabel.has(label));
      const missingAllows = ALLOW_LABELS.filter((label) => !byLabel.has(label));
      const deniedOk = DENY_LABELS.flatMap((label) => byLabel.get(label) ?? []).filter((event) => event.ok);
      const allowedFailures = ALLOW_LABELS.flatMap((label) => byLabel.get(label) ?? []).filter((event) => !event.ok);
      const expectedDenyLabels = new Set(DENY_LABELS);
      const external = events.filter((event) => event.kind === "network" && !expectedDenyLabels.has(event.label) && (() => { try { const host = new URL(event.detail?.url || "").hostname; return !LOOPBACK.has(host); } catch { return true; } })());
      if (missingDenies.length || missingAllows.length || deniedOk.length || allowedFailures.length || external.length) {
        fail(`isolation violated (missingDenies=${missingDenies.join(",") || "none"} missingAllows=${missingAllows.join(",") || "none"} deniedOk=${deniedOk.length} allowedFailures=${allowedFailures.length} external=${external.length})`);
      }
    },
    stop: async () => { if (stopped) return; await mutationChain; await stopServer(); password = null; jwtSecret = null; stopped = true; }
  };
}

/** Launcher-only helper: writes the fixed container authority proof file that
 *  requireLaunchedByHardenedEntrypoint checks for. Called once by
 *  qa-child-entry.mjs before any test runner is spawned. */
export async function writeContainerAuthorityManifest(manifestPath) {
  const resolved = path.resolve(manifestPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const manifest = { kind: AUTHORITY_KIND, version: 1, createdAt: new Date().toISOString() };
  await fs.writeFile(resolved, JSON.stringify(manifest), { mode: 0o600 });
  return manifest;
}
