import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  resolveCursorModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/models", () => ({ getProviderConnectionById: vi.fn() }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: mocks.resolveCursorModels }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const route = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.internal:8080", strictProxy: true };
const connection = {
  id: "cursor-1",
  provider: "cursor",
  authType: "oauth",
  isActive: true,
  accessToken: "cursor-access",
  providerSpecificData: { machineId: "machine-1" },
};

describe("Cursor live model catalog wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue([]);
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue(route);
  });

  it("/v1/models asks the live catalog with the connection's resolved proxy route", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection]);
    mocks.resolveCursorModels.mockResolvedValue({ models: [{ id: "live-cursor-model", name: "Live Cursor Model" }] });

    const models = await buildModelsList([LLM_KIND]);

    expect(models.some((m) => m.id === "cu/live-cursor-model")).toBe(true);
    expect(mocks.resolveCursorModels).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "cursor-access", providerSpecificData: connection.providerSpecificData }),
      expect.objectContaining({ proxyOptions: route }),
    );
  });

  it("/v1/models keeps the static catalog when the live catalog is unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection]);
    mocks.resolveCursorModels.mockResolvedValue(null);

    const models = await buildModelsList([LLM_KIND]);

    expect(models.some((m) => m.id.startsWith("cu/"))).toBe(true);
    expect(models.some((m) => m.id === "cu/live-cursor-model")).toBe(false);
  });

  it("provider models route returns live models and forwards the proxy route", async () => {
    mocks.resolveCursorModels.mockResolvedValue({ models: [{ id: "live-cursor-model", name: "Live Cursor Model", extra: 1 }] });

    const result = await fetchConnectionModels(connection, { requestUrl: "http://localhost/api/providers/cursor-1/models" });

    expect(result.models).toEqual([{ id: "live-cursor-model", name: "Live Cursor Model" }]);
    expect(mocks.resolveCursorModels).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "cursor-access" }),
      expect.objectContaining({ forceRefresh: true, proxyOptions: route }),
    );
  });

  it("provider models route falls back to the static catalog with a warning", async () => {
    mocks.resolveCursorModels.mockResolvedValue(null);

    const result = await fetchConnectionModels(connection, { requestUrl: "http://localhost/api/providers/cursor-1/models" });

    expect(result.models.length).toBeGreaterThan(0);
    expect(result.warning).toMatch(/static catalog/u);
  });
});
