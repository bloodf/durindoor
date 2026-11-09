// Separate OS process using the production synchronous PostgreSQL adapter.
// The parent bundles this file with esbuild and forks a plain Node child with
// an empty execArgv, so no loader hook and no runtime flag is involved.

const { getAdapter } = await import('../../src/lib/db/driver.js');
const { backfillApiKeyUsageTotals } = await import('../../src/lib/db/helpers/apiKeyUsageTotals.js');
const { ensureAndBackfillApiKeyUsageTotals } = await import('../../src/lib/db/migrations/apiKeyUsageTotalsBackfill.js');
const { default: unknownCostRepair } = await import('../../src/lib/db/migrations/028-usage-unknown-cost-repair.js');
const { applyVersionedMigrations } = await import('../../src/lib/db/migrate.js');
const { PG_MIGRATIONS, bootstrapPgMetaTable } = await import('../../src/lib/db/migrations/postgres/index.js');

let adapter;
if (process.env.DURINDOOR_TEST_BOOTSTRAP_V27 === '1') {
  const { createPostgresAdapter } = await import('../../src/lib/db/adapters/pgAdapter.js');
  adapter = await createPostgresAdapter({ url: process.env.DURINDOOR_PG_URL });
  bootstrapPgMetaTable(adapter);
  applyVersionedMigrations(adapter, PG_MIGRATIONS.filter((migration) => migration.version <= 27));
} else {
  adapter = await getAdapter();
}

process.send({
  ready: true,
  pid: process.pid,
  backend: adapter.get('SELECT pg_backend_pid() AS pid').pid,
  driver: adapter.driver,
  execArgv: process.execArgv,
  nodeOptions: process.env.NODE_OPTIONS ?? null,
});

process.on('message', async ({ id, action, args }) => {
  try {
    let value;
    if (action === 'seedKeys') {
      for (const row of args) {
        adapter.run(
          `INSERT INTO "apiKeys"("id","key","name","isActive","allowedCombos","createdAt") VALUES(?, ?, ?, 1, '[]', ?)`,
          [row.id, row.key, row.name, row.createdAt],
        );
      }
      value = true;
    } else if (action === 'seedHistory') {
      for (const row of args) {
        adapter.run(
          `INSERT INTO "usageHistory"("timestamp","provider","model","apiKey","promptTokens","completionTokens","cost","status","tokens","meta")
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.timestamp,
            row.provider ?? null,
            row.model ?? 'fixture-model',
            row.apiKey ?? null,
            row.promptTokens ?? 0,
            row.completionTokens ?? 0,
            row.cost ?? null,
            row.status ?? null,
            row.tokens ?? '{}',
            row.meta === undefined ? '{}' : row.meta,
          ],
        );
      }
      value = true;
    } else if (action === 'seedTotals') {
      for (const row of args) {
        adapter.run(
          `INSERT INTO "apiKeyUsageTotals"("apiKeyId","totalTokens","totalCost","totalRequests","unknownCostRequests","updatedAt")
           VALUES(?, ?, ?, ?, ?, ?)`,
          [
            row.apiKeyId,
            row.totalTokens ?? 0,
            row.totalCost ?? 0,
            row.totalRequests ?? 0,
            row.unknownCostRequests ?? 0,
            row.updatedAt ?? '2026-01-03T00:00:00.000Z',
          ],
        );
      }
      value = true;
    } else if (action === 'backfill') {
      backfillApiKeyUsageTotals(adapter, { overwrite: args === 'overwrite' });
      value = true;
    } else if (action === 'legacyBackfill') {
      ensureAndBackfillApiKeyUsageTotals(adapter);
      value = true;
    } else if (action === 'repair') {
      unknownCostRepair.up(adapter);
      value = true;
    } else if (action === 'migrate') {
      value = applyVersionedMigrations(adapter, PG_MIGRATIONS);
    } else if (action === 'totals') {
      value = adapter.all(
        `SELECT "apiKeyId","totalTokens","totalCost","totalRequests","unknownCostRequests"
         FROM "apiKeyUsageTotals" ORDER BY "apiKeyId"`,
      );
    } else if (action === 'historyCount') {
      value = adapter.get(`SELECT COUNT(*)::int AS n FROM "usageHistory"`).n;
    } else if (action === 'close') {
      await adapter.close();
      // Flush the response, then release the owned IPC channel and the owned
      // message listener so the child can exit on its own.
      process.send({ id, ok: true }, () => {
        process.removeAllListeners('message');
        process.disconnect();
      });
      return;
    } else {
      throw new Error('Unsupported fixture command');
    }
    process.send({ id, ok: true, value });
  } catch (error) {
    process.send({ id, ok: false, error: error.message });
  }
});
