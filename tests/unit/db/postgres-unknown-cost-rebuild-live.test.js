// Opt-in disposable-cluster test. It runs the production synchronous
// PostgreSQL adapter in a separate OS process and proves the unknown-cost
// rebuild parity that the SQLite suite asserts, on the real PostgreSQL
// dialect. A supplied but broken URL fails rather than silently skipping
// acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DURINDOOR_TEST_PG_URL;
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const databaseName = `dd_unknown_cost_${process.pid}_${Date.now()}`;
const keyId = 'unknown-cost-fixture-key';
const apiKey = 'synthetic-unknown-cost-key';
const timestamp = '2026-10-19T12:00:00.000Z';

let admin, sql, url, directory, workerEntry, bundleDirectory, diagnosticsDirectory;
let databaseCreated = false;
const workers = new Set();

async function worker(label) {
  const home = fs.mkdtempSync(path.join(directory, `${label}-`));
  const workerUrl = new URL(url);
  workerUrl.searchParams.set('application_name', `dd-unknown-cost-${label}`);
  const child = fork(workerEntry, [], {
    cwd: repo,
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DATA_DIR: path.join(home, 'data'),
      TMPDIR: directory,
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
      DURINDOOR_DATABASE_ENGINE: 'postgres',
      DURINDOOR_PG_URL: workerUrl.toString(),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const state = { child, stderr: '', pending: new Map(), next: 0 };
  workers.add(state);
  const stdoutLog = fs.createWriteStream(path.join(diagnosticsDirectory, `${label}-${child.pid}.stdout.log`), { flags: 'wx', mode: 0o600 });
  const stderrLog = fs.createWriteStream(path.join(diagnosticsDirectory, `${label}-${child.pid}.stderr.log`), { flags: 'wx', mode: 0o600 });
  state.logsClosed = Promise.all([stdoutLog, stderrLog].map((stream) => new Promise((resolve, reject) => {
    stream.once('close', resolve);
    stream.once('error', reject);
  })));
  child.stdout.pipe(stdoutLog);
  child.stderr.pipe(stderrLog);
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });

  // Protocol settlement: the readiness message resolves the identity promise
  // and every other message settles the request it answers. A child that dies
  // with unanswered requests rejects them instead of hanging the test.
  let settleReady;
  let failReady;
  state.identity = new Promise((resolve, reject) => {
    settleReady = resolve;
    failReady = reject;
  });
  state.exited = new Promise((resolve) => { state.settleExit = resolve; });
  child.on('message', (message) => {
    if (message.ready) {
      settleReady(message);
      return;
    }
    const pending = state.pending.get(message.id);
    if (!pending) return;
    state.pending.delete(message.id);
    if (message.ok) pending.resolve(message);
    else pending.reject(new Error(message.error));
  });
  child.once('error', (error) => {
    failReady(error);
    for (const pending of state.pending.values()) pending.reject(error);
    state.pending.clear();
  });
  child.once('exit', (code, signal) => {
    state.settleExit({ code, signal });
    const error = new Error(`worker exited (${code}/${signal}) with ${state.pending.size} unanswered request(s)`);
    failReady(error);
    for (const pending of state.pending.values()) pending.reject(error);
    state.pending.clear();
  });

  state.identity = await state.identity;
  state.call = (action, args) => new Promise((resolve, reject) => {
    const id = ++state.next;
    state.pending.set(id, { resolve, reject });
    child.send({ id, action, args }, (error) => {
      if (error) {
        state.pending.delete(id);
        reject(error);
      }
    });
  });
  return state;
}

async function closeWorker(state) {
  if (!workers.has(state)) return;
  expect(await state.call('close')).toMatchObject({ ok: true });
  const ended = await state.exited;
  await state.logsClosed;
  if (state.stderr) process.stderr.write(state.stderr);
  expect(ended).toEqual({ code: 0, signal: null });
  workers.delete(state);
}

async function reset() {
  await sql.query(`DELETE FROM "usageHistory"`);
  await sql.query(`DELETE FROM "apiKeyUsageTotals"`);
}

async function totals(apiKeyId) {
  const result = await sql.query(
    `SELECT "totalTokens","totalCost","totalRequests","unknownCostRequests" FROM "apiKeyUsageTotals" WHERE "apiKeyId" = $1`,
    [apiKeyId],
  );
  return result.rows[0] ?? null;
}

describe.skipIf(!adminUrl)('PostgreSQL unknown-cost rebuild parity', () => {
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-pg-unknown-cost-'));
    diagnosticsDirectory = process.env.DURINDOOR_TEST_PG_LOG_DIR || path.join(directory, 'worker-logs');
    fs.mkdirSync(diagnosticsDirectory, { recursive: true, mode: 0o700 });
    // Compile the production imports for a plain Node child. Runtime aliases
    // and the shared CommonJS source need no loader hooks or flags.
    const cache = path.join(repo, 'tests/node_modules/.cache');
    fs.mkdirSync(cache, { recursive: true });
    bundleDirectory = fs.mkdtempSync(path.join(cache, 'pg-unknown-cost-'));
    workerEntry = path.join(bundleDirectory, 'worker.mjs');
    const realtimeConfig = path.join(bundleDirectory, 'realtimeConfig.cjs');
    fs.copyFileSync(path.join(repo, 'src/shared/utils/realtimeConfig.js'), realtimeConfig);
    await build({
      entryPoints: [path.join(repo, 'tests/fixtures/postgres-unknown-cost-rebuild-worker.mjs')],
      outfile: workerEntry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      alias: { '@': path.join(repo, 'src'), 'open-sse': path.join(repo, 'open-sse') },
      plugins: [{
        name: 'shared-commonjs-source',
        setup(builder) {
          builder.onResolve({ filter: /realtimeConfig\.js$/ }, () => ({ path: realtimeConfig }));
        },
      }],
    });
    fs.copyFileSync(workerEntry, path.join(diagnosticsDirectory, 'worker.bundle.mjs'));

    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    const target = new URL(adminUrl);
    target.pathname = `/${databaseName}`;
    url = target.toString();
    sql = new pg.Client({ connectionString: url });
    await sql.connect();
    // The first production adapter connection applies the PostgreSQL migration
    // set, so the schema exists before the fixture seeds anything.
    const bootstrap = await worker('bootstrap');
    await closeWorker(bootstrap);
    await sql.query(
      `INSERT INTO "apiKeys"("id","key","name","isActive","allowedCombos","createdAt") VALUES($1,$2,$3,1,$4,$5)`,
      [keyId, apiKey, 'Synthetic fixture', '[]', timestamp],
    );
  }, 60_000);

  afterAll(async () => {
    for (const state of workers) {
      state.child.kill('SIGKILL');
    }
    workers.clear();
    try { await sql?.end(); } catch { /* already closed */ }
    try { await admin?.end(); } catch { /* already closed */ }
    if (databaseCreated) {
      try { await admin?.query(`DROP DATABASE IF EXISTS ${databaseName}`); } catch { /* cluster already gone */ }
    }
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('runs the production PostgreSQL adapter in a loader-free child process', async () => {
    const state = await worker('probe');
    try {
      expect(state.identity.driver).toBe('pg');
      expect(state.identity.execArgv).toEqual([]);
      expect(state.identity.nodeOptions).toBeNull();
      expect(Number(state.identity.backend)).toBeGreaterThan(0);
    } finally {
      await closeWorker(state);
    }
  });

  it('reconstructs the unknown-cost count when the durable totals row is missing', async () => {
    await reset();
    const state = await worker('reconstruct');
    try {
      await state.call('seedHistory', [{ timestamp, provider: 'openai', apiKey, cost: null, status: 'ok' }]);
      await state.call('backfill', 'fill');
      const row = await totals(keyId);
      // The PostgreSQL driver returns bigint columns as strings.
      expect({
        totalTokens: Number(row.totalTokens),
        totalCost: Number(row.totalCost),
        totalRequests: Number(row.totalRequests),
        unknownCostRequests: Number(row.unknownCostRequests),
      }).toEqual({ totalTokens: 0, totalCost: 0, totalRequests: 1, unknownCostRequests: 1 });
    } finally {
      await closeWorker(state);
    }
  });

  it('exempts the exact failed MCP pair and keeps other provider errors', async () => {
    await reset();
    const state = await worker('exemption');
    try {
      await state.call('seedHistory', [
        { timestamp, provider: 'mcp-gateway', apiKey, cost: null, status: 'error' },
        { timestamp, provider: 'openai', apiKey, cost: null, status: 'error' },
      ]);
      await state.call('backfill', 'fill');
      const row = await totals(keyId);
      expect(Number(row.unknownCostRequests)).toBe(1);
      expect(Number(row.totalRequests)).toBe(1);
    } finally {
      await closeWorker(state);
    }
  });

  it('counts a legacy numeric row whose metadata marks the cost unknown', async () => {
    await reset();
    const state = await worker('legacy-metadata');
    try {
      await state.call('seedHistory', [
        { timestamp, provider: 'openai', apiKey, cost: 0, status: 'ok', meta: JSON.stringify({ costStatus: 'unknown' }) },
      ]);
      await state.call('backfill', 'fill');
      expect(Number((await totals(keyId)).unknownCostRequests)).toBe(1);
    } finally {
      await closeWorker(state);
    }
  });

  it('never lowers a durable count that exceeds the retained history', async () => {
    await reset();
    const state = await worker('monotonic');
    try {
      await state.call('seedHistory', [{ timestamp, provider: 'openai', apiKey, cost: null, status: 'ok' }]);
      await state.call('seedTotals', [{ apiKeyId: keyId, totalRequests: 9, unknownCostRequests: 5 }]);
      await state.call('backfill', 'overwrite');
      expect(Number((await totals(keyId)).unknownCostRequests)).toBe(5);
    } finally {
      await closeWorker(state);
    }
  });

  it('keeps an existing durable count through the legacy replacement rebuild', async () => {
    await reset();
    const state = await worker('legacy-replacement');
    try {
      await state.call('seedHistory', [{ timestamp, provider: 'openai', apiKey, cost: null, status: 'ok' }]);
      await state.call('seedTotals', [{ apiKeyId: keyId, totalRequests: 1, unknownCostRequests: 1 }]);
      await state.call('legacyBackfill');
      const row = await totals(keyId);
      expect(Number(row.unknownCostRequests)).toBe(1);
      expect(Number(row.totalRequests)).toBe(1);
    } finally {
      await closeWorker(state);
    }
  });

  it('repairs a lost count with migration 028 and leaves the other totals untouched', async () => {
    await reset();
    const state = await worker('repair');
    try {
      await state.call('seedHistory', [{ timestamp, provider: 'openai', apiKey, cost: null, status: 'ok' }]);
      await state.call('seedTotals', [{ apiKeyId: keyId, totalTokens: 40, totalCost: 1.5, totalRequests: 12, unknownCostRequests: 0 }]);
      await state.call('repair');
      const row = await totals(keyId);
      expect(Number(row.unknownCostRequests)).toBe(1);
      expect(Number(row.totalTokens)).toBe(40);
      expect(Number(row.totalCost)).toBe(1.5);
      expect(Number(row.totalRequests)).toBe(12);
      await state.call('repair');
      expect(Number((await totals(keyId)).unknownCostRequests)).toBe(1);
    } finally {
      await closeWorker(state);
    }
  });

  it('does not let a repair lower a larger durable count', async () => {
    await reset();
    const state = await worker('repair-monotonic');
    try {
      await state.call('seedHistory', [{ timestamp, provider: 'openai', apiKey, cost: null, status: 'ok' }]);
      await state.call('seedTotals', [{ apiKeyId: keyId, totalRequests: 9, unknownCostRequests: 5 }]);
      await state.call('repair');
      expect(Number((await totals(keyId)).unknownCostRequests)).toBe(5);
    } finally {
      await closeWorker(state);
    }
  });

  it('keeps a durable count that no retained history row can explain', async () => {
    await reset();
    const state = await worker('restored-count');
    try {
      await state.call('seedTotals', [{ apiKeyId: keyId, totalTokens: 40, totalCost: 1.5, totalRequests: 12, unknownCostRequests: 7 }]);
      await state.call('backfill', 'overwrite');
      const row = await totals(keyId);
      expect(Number(row.unknownCostRequests)).toBe(7);
      expect(Number(row.totalRequests)).toBe(0);
    } finally {
      await closeWorker(state);
    }
  });
});
