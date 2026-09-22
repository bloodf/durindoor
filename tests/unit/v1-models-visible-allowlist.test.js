// /v1/models must honour the provider-level "visible models" allowlist even for
// providers served from a live catalog. GitHub Copilot is the case that matters:
// its registry list lags upstream, so a blacklist built from the dashboard's
// model chips can never name catalog-only ids (gpt-4o, copilot-search-a, ...).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  enableModels: vi.fn(),
  getEnabledModels: vi.fn(),
  setEnabledModels: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  resolveCopilotModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
  enableModels: mocks.enableModels,
}));

vi.mock("@/lib/enabledModelsDb", () => ({
  getEnabledModels: mocks.getEnabledModels,
  setEnabledModels: mocks.setEnabledModels,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/copilotModels.js", () => ({
  resolveCopilotModels: mocks.resolveCopilotModels,
}));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

// Live catalog: gpt-5.4 is in the static registry, the other two are not.
const LIVE_MODELS = [
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "copilot-search-a", name: "Copilot Search A" },
];

const githubConnection = (providerSpecificData = {}) => ({
  id: "github-1",
  provider: "github",
  isActive: true,
  accessToken: "github-access",
  providerSpecificData: { copilotToken: "fake-copilot-token", ...providerSpecificData },
});

const ghIds = (models) => models.filter((m) => m.id.startsWith("gh/")).map((m) => m.id);

describe("/v1/models visible-model allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue([]);
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getEnabledModels.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue(null);
    mocks.resolveCopilotModels.mockResolvedValue({ models: LIVE_MODELS });
    mocks.getProviderConnections.mockResolvedValue([githubConnection()]);
  });

  it("exposes the whole live catalog when no allowlist is set", async () => {
    const models = await buildModelsList([LLM_KIND]);
    expect(ghIds(models)).toEqual(
      expect.arrayContaining(["gh/gpt-5.4", "gh/gpt-4o", "gh/copilot-search-a"])
    );
  });

  it("exposes only allowlisted ids once the allowlist is set", async () => {
    mocks.getEnabledModels.mockResolvedValue({ gh: ["gpt-4o"] });
    const models = await buildModelsList([LLM_KIND]);
    expect(ghIds(models)).toEqual(["gh/gpt-4o"]);
  });

  it("ignores blank and duplicate allowlist entries", async () => {
    mocks.getEnabledModels.mockResolvedValue({ gh: ["gpt-4o", "", "   ", "gpt-4o"] });
    const models = await buildModelsList([LLM_KIND]);
    expect(ghIds(models)).toEqual(["gh/gpt-4o"]);
  });

  it("keeps merging custom models, which the allowlist does not hide", async () => {
    mocks.getEnabledModels.mockResolvedValue({ gh: ["gpt-4o"] });
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "gh", id: "gpt-5.6-sol", type: "llm", name: "gpt-5.6-sol" },
    ]);
    const models = await buildModelsList([LLM_KIND]);
    expect(ghIds(models).sort()).toEqual(["gh/gpt-4o", "gh/gpt-5.6-sol"]);
  });

  it("restores the full catalog when the allowlist is an empty array", async () => {
    mocks.getEnabledModels.mockResolvedValue({ gh: [] });
    const ids = ghIds(await buildModelsList([LLM_KIND]));
    expect(ids).toContain("gh/gpt-4o");
    expect(ids).toContain("gh/copilot-search-a");
  });

  it("still honours a hand-set providerSpecificData.enabledModels", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      githubConnection({ enabledModels: ["copilot-search-a"] }),
    ]);
    const ids = ghIds(await buildModelsList([LLM_KIND]));
    expect(ids).toEqual(["gh/copilot-search-a"]);
  });

  it("prefers the provider-level allowlist over a stale per-connection one", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      githubConnection({ enabledModels: ["copilot-search-a"] }),
    ]);
    mocks.getEnabledModels.mockResolvedValue({ gh: ["gpt-4o"] });
    const ids = ghIds(await buildModelsList([LLM_KIND]));
    expect(ids).toEqual(["gh/gpt-4o"]);
  });
});

describe("PUT /api/models/enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setEnabledModels.mockResolvedValue(undefined);
    mocks.enableModels.mockResolvedValue(undefined);
  });

  it("stores the allowlist and drops its ids from the disabled blacklist", async () => {
    const { PUT } = await import("../../src/app/api/models/enabled/route.js");

    const response = await PUT(new Request("http://localhost/api/models/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "gh", ids: ["gpt-5.4"] }),
    }));
    expect(response.status).toBe(200);

    // /v1/models applies the blacklist after the allowlist, so a whitelisted id
    // that stays blacklisted would silently remain hidden.
    // setEnabledModels clears those ids from the blacklist in the same
    // transaction; a separate enableModels write could commit alone.
    expect(mocks.setEnabledModels).toHaveBeenCalledWith("gh", ["gpt-5.4"]);
    expect(mocks.enableModels).not.toHaveBeenCalled();
  });

  it("leaves the blacklist alone when the allowlist write fails", async () => {
    mocks.setEnabledModels.mockRejectedValue(new Error("write failed"));
    const { PUT } = await import("../../src/app/api/models/enabled/route.js");

    const response = await PUT(new Request("http://localhost/api/models/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "gh", ids: ["gpt-5.4"] }),
    }));
    expect(response.status).toBe(500);
    expect(mocks.enableModels).not.toHaveBeenCalled();
  });

  it("does not touch the blacklist when the allowlist is cleared", async () => {
    const { PUT } = await import("../../src/app/api/models/enabled/route.js");

    const response = await PUT(new Request("http://localhost/api/models/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "gh", ids: [] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.setEnabledModels).toHaveBeenCalledWith("gh", []);
    expect(mocks.enableModels).not.toHaveBeenCalled();
  });
});

describe("GET/DELETE /api/models/enabled alias trimming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setEnabledModels.mockResolvedValue(undefined);
    mocks.getEnabledModels.mockResolvedValue({ ds: ["deepseek-chat"] });
  });

  it("trims the query alias on GET", async () => {
    const { GET } = await import("../../src/app/api/models/enabled/route.js");
    const response = await GET(new Request("http://localhost/api/models/enabled?providerAlias=%20ds%20"));
    expect(await response.json()).toEqual({ ids: ["deepseek-chat"] });
  });

  it("trims the query alias on DELETE", async () => {
    const { DELETE } = await import("../../src/app/api/models/enabled/route.js");
    const response = await DELETE(new Request("http://localhost/api/models/enabled?providerAlias=%20ds%20", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(mocks.setEnabledModels).toHaveBeenCalledWith("ds", []);
  });

  it("rejects a blank query alias", async () => {
    const { GET, DELETE } = await import("../../src/app/api/models/enabled/route.js");
    expect((await GET(new Request("http://localhost/api/models/enabled?providerAlias=%20"))).status).toBe(400);
    expect((await DELETE(new Request("http://localhost/api/models/enabled?providerAlias=%20", { method: "DELETE" }))).status).toBe(400);
    expect(mocks.setEnabledModels).not.toHaveBeenCalled();
  });
});
