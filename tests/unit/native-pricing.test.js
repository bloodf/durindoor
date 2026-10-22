import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
let directory, db, adapter, pricing, GET, PATCH, DELETE;
const original = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map(name => [name, process.env[name]]));
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dd-native-pricing-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  pricing = await import("@/lib/db/repos/pricingRepo.js");
  ({
    GET,
    PATCH,
    DELETE
  } = await import("@/app/api/pricing/route.js"));
});
afterAll(async () => {
  await adapter?.close();
  delete global._dbAdapter;
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];else process.env[name] = value;
  }
  fs.rmSync(directory, {
    recursive: true,
    force: true
  });
});
const patch = body => PATCH(new Request("http://localhost/api/pricing", {
  method: "PATCH",
  body: JSON.stringify(body)
}));
const configure = (model, native) => pricing.updatePricing({
  fixture: {
    [model]: {
      native
    }
  }
});
async function save(model, modality, nativeUnits, extra = {}) {
  await db.saveRequestUsage({
    provider: "fixture",
    model,
    modality,
    nativeUnits,
    tokens: {},
    cost: null,
    costStatus: "unknown",
    costSource: "unavailable",
    strict: true,
    ...extra
  });
  const row = adapter.get("SELECT * FROM usageHistory ORDER BY id DESC LIMIT 1");
  return {
    ...row,
    meta: JSON.parse(row.meta)
  };
}
describe("explicit operator native rates", () => {
  it("roundtrips native configuration while keeping the token resolver and reset contract separate", async () => {
    expect((await patch({
      fixture: {
        roundtrip: {
          native: {
            unit: "image",
            rate: 0.25
          }
        }
      }
    })).status).toBe(200);
    expect((await (await GET()).json()).fixture.roundtrip).toEqual({
      native: {
        unit: "image",
        rate: 0.25
      }
    });
    expect(await pricing.getPricingForModel("fixture", "roundtrip")).toBeNull();
    expect((await save("roundtrip", "image", {
      images: 2
    })).cost).toBe(0.5);
    expect((await DELETE(new Request("http://localhost/api/pricing?provider=fixture&model=roundtrip"))).status).toBe(200);
    expect((await save("roundtrip", "image", {
      images: 2
    })).cost).toBeNull();
    await pricing.updatePricing({
      fixture: {
        mixed: {
          input: 2,
          output: 3,
          native: {
            unit: "image",
            rate: 0.5
          }
        }
      }
    });
    const token = await pricing.resolvePricingForModel("fixture", "mixed");
    expect(token.pricing).toEqual({
      input: 2,
      output: 3
    });
    expect(token.provenance.rates).toEqual({
      input: 2,
      output: 3
    });
  });
  it.each([["image", "image", {
    images: 2
  }, 0.25, 0.5], ["audio_second", "stt", {
    audioSeconds: 12.5
  }, 0.02, 0.25], ["audio_second", "music", {
    audioSeconds: 2.5
  }, 0.1, 0.25], ["video_second", "video", {
    videoSeconds: 2.5
  }, 0.2, 0.5], ["video_job", "video", {
    videoJobs: 1
  }, 0.5, 0.5], ["character", "tts", {
    characters: 5
  }, 0.1, 0.5]])("estimates %s from measured units with durable unit/rate/quantity provenance", async (unit, modality, units, rate, cost) => {
    const model = `${unit}-${modality}`;
    await configure(model, {
      unit,
      rate
    });
    const row = await save(model, modality, units);
    expect(row.cost).toBe(cost);
    expect(row.meta).toMatchObject({
      nativeUnits: units,
      costStatus: "estimated",
      costSource: "native-pricing",
      pricing: {
        source: "override",
        currency: "USD",
        unit,
        rate,
        quantity: Object.values(units)[0],
        provider: "fixture",
        model
      }
    });
    const before = adapter.get("SELECT cost,meta FROM usageHistory WHERE id=?", [row.id]);
    await configure(model, {
      unit,
      rate: 9
    });
    await pricing.resetPricing("fixture", model);
    expect(adapter.get("SELECT cost,meta FROM usageHistory WHERE id=?", [row.id])).toEqual(before);
  });
  it("distinguishes zero rates, zero measured duration, missing quantities and authoritative receipts", async () => {
    await configure("zero", {
      unit: "audio_second",
      rate: 0
    });
    expect(await save("zero", "stt", {
      audioSeconds: 12
    })).toMatchObject({
      cost: 0,
      meta: {
        costStatus: "estimated"
      }
    });
    expect(await save("zero", "stt", {})).toMatchObject({
      cost: null,
      meta: {
        costStatus: "unknown"
      }
    });
    await configure("duration", {
      unit: "audio_second",
      rate: 1
    });
    expect(await save("duration", "stt", {
      audioSeconds: 0
    })).toMatchObject({
      cost: 0,
      meta: {
        pricing: {
          quantity: 0
        }
      }
    });
    for (const cost of [0, 0.125]) {
      const row = await save("duration", "stt", {
        audioSeconds: 99
      }, {
        cost,
        costStatus: "known",
        costSource: "provider"
      });
      expect(row.cost).toBe(cost);
      expect(row.meta.costSource).toBe("provider");
      expect(row.meta.pricing).toBeUndefined();
    }
    expect((await save("duration", "image", {
      images: 1
    })).cost).toBeNull();
    expect((await save("unconfigured", "image", {
      images: 2
    })).cost).toBeNull();
  });
  it.each([null, {}, [], {
    unit: "image",
    rate: -1
  }, {
    unit: "image",
    rate: "0.2"
  }, {
    unit: "image",
    rate: true
  }, {
    unit: ["image"],
    rate: 1
  }, {
    unit: "minute",
    rate: 1
  }, {
    unit: "image",
    rate: 1,
    size: "1024x1024"
  }, {
    unit: "image",
    rate: 1,
    dimensions: {
      quality: "high"
    }
  }, {
    unit: "__proto__",
    rate: 1
  }, {
    unit: "image",
    rate: Infinity
  }, {
    unit: "image",
    rate: NaN
  }])("rejects invalid or unsupported native configuration %j", async native => {
    const before = await pricing.getUserPricing();
    expect((await patch({
      fixture: {
        invalid: {
          native
        }
      }
    })).status).toBe(400);
    await expect(configure("invalid", native)).rejects.toThrow(/native pricing/);
    expect(await pricing.getUserPricing()).toEqual(before);
  });
  it("rejects nonfinite, negative, coerced or fractional count units without committing", async () => {
    await configure("invalid-quantity", {
      unit: "image",
      rate: 1
    });
    const before = adapter.get("SELECT count(*) AS n FROM usageHistory").n;
    for (const images of [NaN, Infinity, -1, "1", false, 0.5]) await expect(save("invalid-quantity", "image", {
      images
    })).rejects.toThrow();
    await configure("overflow", {
      unit: "audio_second",
      rate: Number.MAX_VALUE
    });
    await expect(save("overflow", "stt", {
      audioSeconds: 2
    })).rejects.toThrow(/overflow/);
    expect(adapter.get("SELECT count(*) AS n FROM usageHistory").n).toBe(before);
  });
});
