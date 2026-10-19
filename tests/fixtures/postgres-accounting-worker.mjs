// Separate OS process using the production synchronous PostgreSQL adapter.
import { getAdapter } from '../../src/lib/db/driver.js';
import { saveRequestUsage, getBillingEpoch, getApiKeyWindowUsageTotals } from '../../src/lib/db/repos/usageRepo.js';
import { getApiKeyUsageTotals } from '../../src/lib/db/repos/apiKeyUsageTotalsRepo.js';
import { createMediaJob, finishMediaJob, getMediaJob } from '../../src/lib/db/repos/mediaJobsRepo.js';
const adapter = await getAdapter();
process.send({
  ready: true,
  pid: process.pid,
  backend: adapter.get('SELECT pg_backend_pid() AS pid').pid,
  driver: adapter.driver
});
async function recordJob(job, apiKey) {
  if (job.terminal?.status !== 'succeeded') throw new Error('Terminal success required');
  const {
    response,
    status,
    ...accounting
  } = job.terminal;
  return saveRequestUsage({
    ...accounting,
    apiKey,
    provider: job.provider,
    model: job.model,
    connectionId: job.connectionId,
    endpoint: job.endpoint,
    usageEventId: job.usageEventId,
    billingEpoch: job.billingEpoch,
    modality: 'video',
    status: 'ok',
    strict: true
  });
}
process.on('message', async ({
  id,
  action,
  args
}) => {
  try {
    let value;
    if (action === 'save') {
      value = [];
      for (const entry of args) value.push(await saveRequestUsage({
        ...entry,
        strict: true
      }));
    } else if (action === 'epoch') value = await getBillingEpoch();else if (action === 'summary') value = {
      totals: await getApiKeyUsageTotals(args.keyId),
      window: await getApiKeyWindowUsageTotals(args.apiKey, args.dayStart, args.monthStart)
    };else if (action === 'createJob') value = await createMediaJob(args);else if (action === 'finishJob') {
      value = await finishMediaJob(args.job, args.apiKeyId, args.terminal);
      if (args.record) await recordJob(value, args.apiKey);
    } else if (action === 'replayJob') {
      value = await getMediaJob(args.job, args.apiKeyId);
      await recordJob(value, args.apiKey);
    } else if (action === 'close') {
      await adapter.close();
      process.send({
        id,
        ok: true
      });
      process.disconnect();
      return;
    } else throw new Error('Unsupported fixture command');
    process.send({
      id,
      ok: true,
      value
    });
  } catch (error) {
    process.send({
      id,
      ok: false,
      error: error.message
    });
  }
});
