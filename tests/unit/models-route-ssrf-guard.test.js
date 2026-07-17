import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";

/**
 * OmniRoute #6966 — `/v1/models` live model-list discovery must use the same
 * local-first SSRF guard tier as the provider test-connection path
 * (`getProviderValidationGuard`). Upstream: the models route previously used
 * the stricter outbound guard ("public-only"), which rejected LAN-local
 * OpenAI-compatible providers (e.g. LM Studio on 192.168.x.x) even though the
 * connection test for the same host succeeded under default settings.
 *
 * These tests drive the ROUTE (not the helper) end-to-end through the
 * aggregation, proving the named target `src/app/api/v1/models/route.js`
 * resolves and threads the policy:
 *   - remote (public) discovery fetch still happens (guard allows),
 *   - LAN discovery fetch happens under the local-first default
 *     ("block-metadata") — with `redirect: "manual"` hardening,
 *   - cloud-metadata endpoints are blocked BEFORE any fetch (SSRF→IAM pivot),
 *   - with local URLs disabled ("public-only"), LAN discovery is blocked too.
 */

const originalFetch = global.fetch;
const GUARD_ENV_VARS = [
  "OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS",
  "OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS",
  "OUTBOUND_SSRF_GUARD_ENABLED",
];
const savedEnv = Object.fromEntries(GUARD_ENV_VARS.map((k) => [k, process.env[k]]));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(() => Promise.resolve([])),
  getCustomModels: vi.fn(() => Promise.resolve([])),
  getModelAliases: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(() => Promise.resolve({ hidePaidModels: false })),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));

import { getProviderConnections } from "@/lib/localDb";
// Top-level import so the module graph (including proxyFetch's globalThis
// patching) settles BEFORE tests replace `global.fetch` with a spy; a lazy
// import inside the test would clobber the spy mid-flight.
import { GET } from "../../src/app/api/v1/models/route.js";

/** Restore the local-first default (local ON, private unset). */
function resetGuardEnv() {
  for (const k of GUARD_ENV_VARS) delete process.env[k];
}

function seedLanConnection(baseUrl) {
  getProviderConnections.mockResolvedValue([
    {
      id: "conn-lan",
      provider: "lm-studio",
      isActive: true,
      apiKey: "local-key",
      providerSpecificData: { baseUrl },
    },
  ]);
}

async function callModelsRoute() {
  const res = await GET(new Request("http://x/v1/models"));
  expect(res.status).toBe(200);
  return res.json();
}

describe("/v1/models discovery SSRF guard (OmniRoute #6966)", () => {
  // Each case starts from the local-first default (local ON, private unset);
  // cases that need a stricter policy set their own env on top.
  beforeEach(() => {
    resetGuardEnv();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // Restore host env values captured at import time.
  afterAll(() => {
    for (const k of GUARD_ENV_VARS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("allows remote (public) provider discovery fetches", async () => {
    seedLanConnection("https://lm-studio.example.com/v1");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "remote-model-a" }] }),
    });

    const body = await callModelsRoute();
    const ids = body.data.map((m) => m.id);

    expect(ids).toContain("lmstudio/remote-model-a");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://lm-studio.example.com/v1/models",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("allows LAN-local discovery under the default local-first guard (LM Studio regression)", async () => {
    seedLanConnection("http://192.168.1.50:1234/v1");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "lan-model-a" }] }),
    });

    const body = await callModelsRoute();
    const ids = body.data.map((m) => m.id);

    expect(ids).toContain("lmstudio/lan-model-a");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.50:1234/v1/models",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("blocks cloud-metadata discovery before any fetch, even under the local-first default", async () => {
    seedLanConnection("http://169.254.169.254/latest/meta-data");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "metadata-model" }] }),
    });

    const body = await callModelsRoute();
    const ids = body.data.map((m) => m.id);

    // Blocked endpoint contributes no live catalog, but the route still 200s.
    expect(ids).not.toContain("lmstudio/metadata-model");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks LAN discovery when local provider URLs are disabled (public-only)", async () => {
    process.env.OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS = "false";
    seedLanConnection("http://192.168.1.50:1234/v1");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "lan-model-a" }] }),
    });

    const body = await callModelsRoute();
    const ids = body.data.map((m) => m.id);

    expect(ids).not.toContain("lmstudio/lan-model-a");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

