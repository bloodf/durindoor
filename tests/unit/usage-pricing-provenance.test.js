import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
let directory, db, adapter;
const original = Object.fromEntries(['DATA_DIR', 'DURINDOOR_DATABASE_ENGINE', 'DURINDOOR_PG_URL'].map(name => [name, process.env[name]]));
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-pricing-proof-'));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = 'sqlite';
  delete process.env.DURINDOOR_PG_URL;
  vi.resetModules();
  db = await import('@/lib/db/index.js');
  await db.initDb();
  adapter = await (await import('@/lib/db/driver.js')).getAdapter();
});
afterAll(async () => {
  await adapter?.close();
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];else process.env[name] = value;
  }
  fs.rmSync(directory, {
    recursive: true,
    force: true
  });
});
async function save(model, extra = {}) {
  await db.saveRequestUsage({
    provider: 'openai',
    model,
    tokens: {
      input_tokens: 1e6,
      output_tokens: 1e6
    },
    status: 'ok',
    meta: { pricing: { source: 'stale-caller-rate', rates: { input: 999 } } },
    strict: true,
    ...extra
  });
  const row = adapter.get('SELECT cost, meta FROM usageHistory ORDER BY id DESC LIMIT 1');
  return {
    cost: row.cost,
    meta: JSON.parse(row.meta)
  };
}
describe('durable token price provenance', () => {
  it('snapshots builtin rates and a partial override without repricing history after edits or reset', async () => {
    const builtin = await save('gpt-5.4');
    expect(builtin.meta).toMatchObject({
      costStatus: 'estimated',
      costSource: 'pricing',
      pricing: {
        source: 'builtin',
        unit: 'USD_per_million_tokens',
        provider: 'openai',
        model: 'gpt-5.4',
        rates: {
          input: 2.5,
          output: 15
        }
      }
    });
    await db.updatePricing({
      openai: {
        'gpt-5.4': {
          input: 7
        }
      }
    });
    const custom = await save('gpt-5.4');
    expect(custom.cost).toBe(22);
    expect(custom.meta.pricing).toMatchObject({
      source: 'override',
      overrideModel: 'gpt-5.4',
      overrides: {
        input: 7
      },
      rates: {
        input: 7,
        output: 15
      }
    });
    const saved = adapter.all('SELECT id, cost, meta FROM usageHistory ORDER BY id');
    await db.updatePricing({
      openai: {
        'gpt-5.4': {
          input: 20,
          output: 30
        }
      }
    });
    expect((await save('gpt-5.4')).cost).toBe(50);
    await db.resetPricing('openai', 'gpt-5.4');
    expect((await save('gpt-5.4')).cost).toBe(builtin.cost);
    expect(adapter.all('SELECT id, cost, meta FROM usageHistory WHERE id <= ? ORDER BY id', [saved.at(-1).id])).toEqual(saved);
  });
  it('keeps an explicit zero override estimated, and provider zero or paid receipts authoritative', async () => {
    await db.updatePricing({
      openai: {
        'fixture-zero': {
          input: 0,
          output: 0
        }
      }
    });
    expect(await save('fixture-zero')).toMatchObject({
      cost: 0,
      meta: {
        costStatus: 'estimated',
        pricing: {
          source: 'override',
          rates: {
            input: 0,
            output: 0
          }
        }
      }
    });
    for (const cost of [0, 0.125]) {
      const row = await save('fixture-zero', {
        tokens: {
          input_tokens: 1e6,
          output_tokens: 1e6,
          cost_usd: cost
        }
      });
      expect(row).toMatchObject({
        cost,
        meta: {
          costStatus: 'known',
          costSource: 'provider'
        }
      });
      expect(row.meta.pricing).toBeUndefined();
    }
  });
  it('preserves the existing builtin free and subscription estimate semantics', async () => {
    const free = await save('glm-4.7-flash');
    expect(free).toMatchObject({
      cost: 0,
      meta: {
        costStatus: 'estimated',
        pricing: {
          source: 'builtin',
          rates: {
            input: 0,
            output: 0
          }
        }
      }
    });
    const subscription = await save('gpt-5.6-sol', {
      provider: 'codex'
    });
    expect(subscription).toMatchObject({
      cost: 11.25,
      meta: {
        costStatus: 'estimated',
        costSource: 'pricing',
        pricing: {
          source: 'builtin'
        }
      }
    });
    // This is a configured equivalent token value, not evidence of a cash invoice.
    expect(subscription.meta.costStatus).not.toBe('known');
  });
  it('records the canonical override key for a synthetic subscription variant', async () => {
    await db.updatePricing({
      kiro: {
        'gpt-5.6-sol': {
          input: 4,
          output: 6
        }
      }
    });
    const row = await save('gpt-5.6-sol-thinking', {
      provider: 'kiro'
    });
    expect(row).toMatchObject({
      cost: 10,
      meta: {
        costStatus: 'estimated',
        pricing: {
          source: 'override',
          model: 'gpt-5.6-sol-thinking',
          overrideModel: 'gpt-5.6-sol',
          overrides: {
            input: 4,
            output: 6
          }
        }
      }
    });
  });
  it('keeps unpriced native units unknown even when a token override exists', async () => {
    await db.updatePricing({
      openai: {
        'fixture-native': {
          input: 2,
          output: 3
        }
      }
    });
    const row = await save('fixture-native', {
      modality: 'audio',
      nativeUnits: {
        audioSeconds: 30
      },
      cost: null,
      costStatus: 'unknown',
      costSource: 'unavailable'
    });
    expect(row).toMatchObject({
      cost: null,
      meta: {
        costStatus: 'unknown',
        nativeUnits: {
          audioSeconds: 30
        }
      }
    });
    expect(row.meta.pricing).toBeUndefined();
    expect(await save('fixture-no-rates')).toMatchObject({
      cost: null,
      meta: {
        costStatus: 'unknown',
        costSource: 'unavailable'
      }
    });
  });
});
