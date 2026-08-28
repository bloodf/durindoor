import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveObservabilityEnabled } from "@/lib/db/repos/requestDetailsRepo.js";

const OFF = { enableObservability: false };
const ON = { enableObservability: true };

describe("observability enable resolution", () => {
  it("uses OBSERVABILITY_ENABLED before the canonical setting", () => {
    expect(resolveObservabilityEnabled(OFF, { OBSERVABILITY_ENABLED: "true" })).toBe(true);
    expect(resolveObservabilityEnabled(ON, { OBSERVABILITY_ENABLED: "false" })).toBe(false);
  });

  it("uses the canonical setting when OBSERVABILITY_ENABLED is unset or empty", () => {
    expect(resolveObservabilityEnabled(OFF, {})).toBe(false);
    expect(resolveObservabilityEnabled(ON, {})).toBe(true);
    expect(resolveObservabilityEnabled(ON, { OBSERVABILITY_ENABLED: "  " })).toBe(true);
    expect(resolveObservabilityEnabled(undefined, {})).toBe(false);
  });

  it("keeps ENABLE_REQUEST_LOGS scoped to file logging", () => {
    expect(resolveObservabilityEnabled(OFF, { ENABLE_REQUEST_LOGS: "true" })).toBe(false);
    expect(resolveObservabilityEnabled(ON, { ENABLE_REQUEST_LOGS: "false" })).toBe(true);
    expect(resolveObservabilityEnabled(OFF, {
      ENABLE_REQUEST_LOGS: "false",
      OBSERVABILITY_ENABLED: "true",
    })).toBe(true);
  });
});

describe("request-detail persistence enablement", () => {
  const originalObservabilityEnabled = process.env.OBSERVABILITY_ENABLED;
  const originalEnableRequestLogs = process.env.ENABLE_REQUEST_LOGS;
  let rows;

  beforeEach(() => {
    rows = [];
    delete process.env.OBSERVABILITY_ENABLED;
    delete process.env.ENABLE_REQUEST_LOGS;
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db/driver.js");
    vi.doUnmock("@/lib/db/repos/settingsRepo.js");
    if (originalObservabilityEnabled === undefined) delete process.env.OBSERVABILITY_ENABLED;
    else process.env.OBSERVABILITY_ENABLED = originalObservabilityEnabled;
    if (originalEnableRequestLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
    else process.env.ENABLE_REQUEST_LOGS = originalEnableRequestLogs;
  });

  async function loadRepo(enableObservability) {
    const adapter = {
      transaction: (write) => write(),
      run: (sql, params) => {
        if (sql.startsWith("INSERT INTO requestDetails")) rows.push(params);
      },
      get: (sql) => ({ c: sql.startsWith("SELECT COUNT(*)") ? rows.length : 0 }),
    };
    vi.doMock("@/lib/db/driver.js", () => ({ getAdapter: async () => adapter }));
    vi.doMock("@/lib/db/repos/settingsRepo.js", () => ({
      getSettings: async () => ({
        enableObservability,
        observabilityBatchSize: 1,
      }),
    }));
    return import("@/lib/db/repos/requestDetailsRepo.js");
  }

  it("persists details when OBSERVABILITY_ENABLED enables a disabled setting", async () => {
    process.env.OBSERVABILITY_ENABLED = "true";
    process.env.ENABLE_REQUEST_LOGS = "false";
    const repo = await loadRepo(false);

    await repo.saveRequestDetail({ id: "env-enabled", provider: "test", model: "test" });
    await expect.poll(() => rows[0]?.slice(0, 4)).toEqual([
      "env-enabled",
      expect.any(String),
      "test",
      "test",
    ]);
    expect(JSON.parse(rows[0][6])).toMatchObject({ id: "env-enabled", provider: "test", model: "test" });
  });

  it("does not persist details when OBSERVABILITY_ENABLED vetoes an enabled setting", async () => {
    process.env.OBSERVABILITY_ENABLED = "false";
    const repo = await loadRepo(true);

    await repo.saveRequestDetail({ id: "env-disabled", provider: "test", model: "test" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(rows).toHaveLength(0);
  });
});
