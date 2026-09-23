import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

// OmniRoute #11481 (port(omniroute)): operator glob allow/deny list for
// /v1/models exposure. Exercises the backstop filter in buildModelsList.js
// (mirrors the existing hidePaidModels backstop test pattern).

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";
import * as settingsRepo from "@/lib/db/repos/settingsRepo";

function stub(settings) {
  localDb.getProviderConnections.mockResolvedValue([
    {
      id: "conn-cbcn",
      provider: "codebuddy-cn",
      isActive: true,
      apiKey: "sk-test",
      providerSpecificData: {},
    },
  ]);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue([]);
  localDb.getModelAliases.mockResolvedValue({});
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
  settingsRepo.getSettings.mockResolvedValue(settings);
}

describe("buildModelsList — model exposure allow/deny list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes everything when both lists are empty (default off)", async () => {
    stub({});
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids).toContain("cbcn/glm-5.2");
  });

  it("hides an exact-match denylist entry", async () => {
    stub({ modelVisibilityDenylist: ["cbcn/glm-5.2"] });
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids).not.toContain("cbcn/glm-5.2");
  });

  it("hides a glob-match denylist entry", async () => {
    stub({ modelVisibilityDenylist: ["cbcn/*"] });
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids).not.toContain("cbcn/glm-5.2");
  });

  it("restricts to a non-matching allowlist", async () => {
    stub({ modelVisibilityAllowlist: ["nonexistent/*"] });
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids).not.toContain("cbcn/glm-5.2");
  });

  it("keeps a matching allowlist entry", async () => {
    stub({ modelVisibilityAllowlist: ["cbcn/*"] });
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids).toContain("cbcn/glm-5.2");
  });

  it("denylist wins over an overlapping allowlist entry", async () => {
    stub({ modelVisibilityAllowlist: ["cbcn/*"], modelVisibilityDenylist: ["cbcn/glm-5.2"] });
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids).not.toContain("cbcn/glm-5.2");
  });
});
