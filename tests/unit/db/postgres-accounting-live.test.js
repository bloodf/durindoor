// Opt-in disposable-cluster test. Unlike SQLite fixtures, this runs two OS
// processes with independent production PG adapters and a third lock owner.
// A supplied but broken URL fails rather than silently skipping acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const adminUrl = process.env.DURINDOOR_TEST_PG_URL;
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const keyId = 'accounting-fixture-key';
const apiKey = 'synthetic-accounting-key';
const epoch = 'fixture-epoch-before';
const timestamp = '2026-10-19T12:00:00.000Z';
const databaseName = `dd_accounting_${process.pid}_${Date.now()}`;
let admin, sql, holder, url, directory;
let databaseCreated = false;
const workers = new Set();
async function worker(label) {
  const home = fs.mkdtempSync(path.join(directory, `${label}-`));
  const workerUrl = new URL(url);
  workerUrl.searchParams.set('application_name', `dd-accounting-${label}`);
  const child = fork(path.join(repo, 'tests/fixtures/postgres-accounting-worker.mjs'), [], {
    cwd: repo,
    execArgv: ['--experimental-default-type=module', '--loader', path.join(repo, 'tests/fixtures/postgres-accounting-loader.mjs')],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DATA_DIR: path.join(home, 'data'),
      TMPDIR: directory,
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
      DURINDOOR_DATABASE_ENGINE: 'postgres',
      DURINDOOR_PG_URL: workerUrl.toString()
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const state = {
    child,
    stderr: '',
    pending: new Map(),
    next: 0
  };
  workers.add(state);
  child.stdout.resume();
  child.stderr.on('data', chunk => {
    state.stderr += chunk;
  });
  state.exited = new Promise(resolve => child.once('exit', (code, signal) => {
    for (const entry of state.pending.values()) entry.reject(new Error(`Worker exited ${code}/${signal}: ${state.stderr}`));
    state.pending.clear();
    resolve({
      code,
      signal
    });
  }));
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (message.ready) {
        state.identity = message;
        resolve(message);
        return;
      }
      const entry = state.pending.get(message.id);
      if (entry) {
        state.pending.delete(message.id);
        entry.resolve(message);
      }
    });
    state.exited.then(() => reject(new Error(`Worker exited before ready: ${state.stderr}`)));
  });
  await ready;
  expect(state.identity.driver).toBe('pg');
  state.call = (action, args) => new Promise((resolve, reject) => {
    const id = ++state.next;
    state.pending.set(id, {
      resolve,
      reject
    });
    child.send({
      id,
      action,
      args
    });
  });
  return state;
}
async function closeWorker(state, crash = false) {
  if (!workers.has(state)) return;
  if (crash) state.child.kill('SIGKILL');else expect(await state.call('close')).toMatchObject({
    ok: true
  });
  const ended = await state.exited;
  expect(ended).toEqual(crash ? {
    code: null,
    signal: 'SIGKILL'
  } : {
    code: 0,
    signal: null
  });
  workers.delete(state);
}
async function pair() {
  const a = await worker('a');
  const b = await worker('b');
  expect(a.identity.pid).not.toBe(b.identity.pid);
  expect(a.identity.backend).not.toBe(b.identity.backend);
  return [a, b];
}
async function lockedWriters(count = 2) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const result = await sql.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'dd-accounting-%' AND wait_event_type = 'Lock'");
    if (result.rows[0].n === count) return;
    await delay(20);
  }
  throw new Error('Production writers did not wait on the held PostgreSQL lock');
}
function event(id, cost = 0.25, extra = {}) {
  return {
    usageEventId: id,
    billingEpoch: epoch,
    apiKey,
    provider: 'fixture',
    model: 'receipt-priced',
    connectionId: 'fixture-account',
    endpoint: '/v1/images/generations',
    modality: 'image',
    timestamp,
    tokens: {
      input_tokens: 2,
      output_tokens: 3
    },
    nativeUnits: {
      images: 1
    },
    cost,
    costStatus: cost === null ? 'unknown' : 'known',
    costSource: cost === null ? 'unavailable' : 'provider',
    ...extra
  };
}
async function snapshot() {
  const result = {};
  for (const table of ['usageHistory', 'usageDaily', 'apiKeyUsageTotals']) {
    result[table] = (await sql.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
  }
  result.receipts = (await sql.query("SELECT key, value FROM kv WHERE scope='usageEventReceipts' ORDER BY key")).rows;
  result.lifetime = (await sql.query("SELECT value FROM _meta WHERE key='totalRequestsLifetime'")).rows;
  return result;
}
describe.skipIf(!adminUrl)('PostgreSQL multi-process accounting', () => {
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-pg-accounting-'));
    admin = new pg.Client({
      connectionString: adminUrl,
      connectionTimeoutMillis: 2000
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    const target = new URL(adminUrl);
    target.pathname = `/${databaseName}`;
    url = target.toString();
    const bootstrap = await worker('bootstrap');
    await closeWorker(bootstrap);
    sql = new pg.Client({
      connectionString: url
    });
    holder = new pg.Client({
      connectionString: url
    });
    await sql.connect();
    await holder.connect();
    await sql.query('INSERT INTO "apiKeys"(id,key,name,"isActive","allowedCombos","createdAt") VALUES($1,$2,$3,1,$4,$5)', [keyId, apiKey, 'Synthetic fixture', '[]', timestamp]);
  }, 60_000);
  beforeEach(async () => {
    await sql.query('TRUNCATE "usageHistory", "usageDaily", "usageLastSeen", "apiKeyUsageTotals" RESTART IDENTITY');
    await sql.query("DELETE FROM kv WHERE scope IN ('usageEventReceipts','mediaJobs','billing')");
    await sql.query("INSERT INTO kv(scope,key,value) VALUES('billing','epoch',$1)", [JSON.stringify(epoch)]);
    await sql.query("DELETE FROM _meta WHERE key='totalRequestsLifetime'");
  });
  afterEach(async () => {
    await holder?.query('ROLLBACK');
    for (const state of [...workers]) {
      state.child.kill('SIGKILL');
      await state.exited;
      workers.delete(state);
    }
  });
  afterAll(async () => {
    for (const state of [...workers]) {
      state.child.kill('SIGKILL');
      await state.exited;
      workers.delete(state);
    }
    try {
      await Promise.all([sql?.end(), holder?.end()]);
      if (databaseCreated) await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    } finally {
      try { await admin?.end(); }
      finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }); }
    }
  });
  it.each(['COMMIT', 'ROLLBACK'])('serializes absent and existing counters behind a third connection %s', async release => {
    const [a, b] = await pair();
    for (let round = 0; round < 2; round++) {
      const at = `2026-10-${19 + round}T12:00:00.000Z`;
      const batch = name => [event(`shared-${round}`, 0.25, {
        timestamp: at
      }), event(`${name}-paid-${round}`, 0.125, {
        timestamp: at,
        tokens: {
          input_tokens: 3
        }
      }), event(`${name}-zero-${round}`, 0, {
        timestamp: at,
        tokens: {
          input_tokens: 2
        }
      }), event(`${name}-unknown-${round}`, null, {
        timestamp: at,
        tokens: {
          input_tokens: 5
        }
      })];
      await holder.query('BEGIN');
      await holder.query("SELECT value FROM _meta WHERE key='schemaVersion' FOR UPDATE");
      const writes = [a.call('save', batch('a')), b.call('save', batch('b'))];
      await lockedWriters();
      expect((await sql.query('SELECT count(*)::int AS n FROM "usageHistory"')).rows[0].n).toBe(round * 7);
      await holder.query(release);
      for (const result of await Promise.all(writes)) expect(result).toMatchObject({
        ok: true,
        value: [true, true, true, true]
      });
      const n = round + 1;
      const summary = await a.call('summary', {
        keyId,
        apiKey,
        dayStart: '2026-10-19T00:00:00Z',
        monthStart: '2026-10-01T00:00:00Z'
      });
      expect(summary).toMatchObject({
        ok: true,
        value: {
          totals: {
            totalRequests: 7 * n,
            totalCost: 0.5 * n,
            totalTokens: 25 * n,
            unknownCostRequests: 2 * n
          },
          window: {
            day: {
              requests: 7 * n,
              cost: 0.5 * n,
              inputTokens: 22 * n,
              outputTokens: 3 * n,
              unknownCostRequests: 2 * n
            },
            month: {
              requests: 7 * n,
              cost: 0.5 * n,
              inputTokens: 22 * n,
              outputTokens: 3 * n,
              unknownCostRequests: 2 * n
            }
          }
        }
      });
      const state = await snapshot();
      expect(state.usageHistory).toHaveLength(7 * n);
      expect(state.receipts).toHaveLength(7 * n);
      expect(state.lifetime).toEqual([{
        value: String(7 * n)
      }]);
      for (const row of state.usageDaily) {
        const day = JSON.parse(row.data);
        expect(day).toMatchObject({
          requests: 7,
          cost: 0.5,
          promptTokens: 22,
          completionTokens: 3,
          unknownCostRequests: 2
        });
        for (const dimension of ['byProvider', 'byModel', 'byAccount', 'byApiKey', 'byEndpoint']) {
          expect(Object.values(day[dimension])).toEqual([expect.objectContaining({
            requests: 7,
            cost: 0.5,
            unknownCostRequests: 2
          })]);
        }
      }
    }
    await closeWorker(a);
    await closeWorker(b);
  }, 30_000);
  it('rejects in-flight old epochs after cutover and deduplicates new-epoch replay after process reopen', async () => {
    const [a, b] = await pair();
    expect(await a.call('epoch')).toMatchObject({
      value: epoch
    });
    await holder.query('BEGIN');
    await holder.query("SELECT value FROM _meta WHERE key='schemaVersion' FOR UPDATE");
    await holder.query("UPDATE kv SET value=$1 WHERE scope='billing' AND key='epoch'", [JSON.stringify('fixture-epoch-after')]);
    const writes = [a.call('save', [event('old')]), b.call('save', [event('old')])];
    await lockedWriters();
    await holder.query('COMMIT');
    for (const result of await Promise.all(writes)) expect(result).toMatchObject({
      ok: false,
      error: 'Stale or missing billing epoch'
    });
    expect((await snapshot()).usageHistory).toEqual([]);
    const fresh = event('old', 0.25, {
      billingEpoch: 'fixture-epoch-after'
    });
    expect(await a.call('save', [fresh])).toMatchObject({
      ok: true
    });
    const committed = await snapshot();
    await closeWorker(a);
    await closeWorker(b);
    const reopened = await pair();
    for (const result of await Promise.all(reopened.map(w => w.call('save', [fresh])))) expect(result).toMatchObject({
      ok: true
    });
    expect(await snapshot()).toEqual(committed);
  }, 30_000);
  it('rolls back receipt, history and aggregates on totals failure, then permits one retry', async () => {
    const a = await worker('rollback');
    await sql.query("CREATE FUNCTION fail_accounting_totals() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected totals failure'; END $$");
    await sql.query('CREATE TRIGGER fail_accounting_totals BEFORE INSERT ON "apiKeyUsageTotals" FOR EACH ROW EXECUTE FUNCTION fail_accounting_totals()');
    try {
      const before = await snapshot();
      expect(await a.call('save', [event('rollback')])).toMatchObject({
        ok: false,
        error: expect.stringContaining('injected totals failure')
      });
      expect(await snapshot()).toEqual(before);
    } finally {
      await sql.query('DROP TRIGGER fail_accounting_totals ON "apiKeyUsageTotals"');
      await sql.query('DROP FUNCTION fail_accounting_totals()');
    }
    expect(await a.call('save', [event('rollback'), event('rollback')])).toMatchObject({
      ok: true
    });
    const saved = await snapshot();
    expect(saved.usageHistory).toHaveLength(1);
    expect(saved.receipts).toHaveLength(1);
    expect(saved.lifetime).toEqual([{
      value: '1'
    }]);
  }, 30_000);
  it('keeps first terminal evidence across competing processes, OS death and cross-account job IDs', async () => {
    let [a, b] = await pair();
    const job = {
      provider: 'fixture',
      connectionId: 'account-one',
      resourceId: 'same-provider-id',
      apiKeyId: keyId,
      model: 'video',
      endpoint: '/v1/videos/generations',
      usageEventId: 'video-account-one',
      billingEpoch: epoch
    };
    expect(await a.call('createJob', job)).toMatchObject({
      ok: true
    });
    const terminal = cost => ({
      status: 'succeeded',
      tokens: {
        input_tokens: 2,
        output_tokens: 3
      },
      nativeUnits: {
        videoSeconds: 5
      },
      cost,
      costStatus: 'known',
      costSource: 'provider',
      meta: {
        providerCost: {
          path: 'usage.cost_usd',
          value: cost
        }
      },
      response: {
        body: 'complete',
        status: 200
      }
    });
    await holder.query('BEGIN');
    await holder.query("SELECT value FROM _meta WHERE key='schemaVersion' FOR UPDATE");
    const endings = [a.call('finishJob', {
      job,
      apiKeyId: keyId,
      terminal: terminal(0.25)
    }), b.call('finishJob', {
      job,
      apiKeyId: keyId,
      terminal: terminal(0.75)
    })];
    await lockedWriters();
    await holder.query('COMMIT');
    const [first, second] = await Promise.all(endings);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.value.terminal).toEqual(second.value.terminal);
    const winning = first.value.terminal;
    expect((await snapshot()).usageHistory).toEqual([]);
    // Kill both processes after durable terminal commit, before accounting.
    await closeWorker(a, true);
    await closeWorker(b, true);
    [a, b] = await pair();
    for (const result of await Promise.all([a, b].map(w => w.call('replayJob', {
      job,
      apiKeyId: keyId,
      apiKey
    })))) expect(result).toMatchObject({
      ok: true,
      value: {
        terminal: winning
      }
    });
    let state = await snapshot();
    expect(state.usageHistory).toHaveLength(1);
    expect(Number(state.usageHistory[0].cost)).toBe(winning.cost);
    expect(JSON.parse(state.usageHistory[0].meta)).toMatchObject(winning.meta);
    const other = {
      ...job,
      connectionId: 'account-two',
      usageEventId: 'video-account-two'
    };
    expect(await a.call('createJob', other)).toMatchObject({
      ok: true
    });
    expect(await b.call('finishJob', {
      job: other,
      apiKeyId: keyId,
      terminal: terminal(0.125),
      record: true,
      apiKey
    })).toMatchObject({
      ok: true
    });
    state = await snapshot();
    expect(state.usageHistory).toHaveLength(2);
    expect(state.receipts).toHaveLength(2);
    expect(state.usageHistory.map(row => row.connectionId).sort()).toEqual(['account-one', 'account-two']);
  }, 30_000);
});
