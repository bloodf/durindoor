import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  clearQoderCatalog,
  getQoderModelConfig,
  resolveQoderModels,
} from "../../open-sse/services/qoderModels.js";

const credentials = {
  accessToken: "access-token",
  providerSpecificData: { userId: "user-id" },
};

function catalog(chat) {
  mocks.proxyAwareFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ chat }),
  });
}

describe("Qoder cmodel catalog fallback (#3231)", () => {
  beforeEach(() => {
    clearQoderCatalog();
    mocks.proxyAwareFetch.mockReset();
  });

  it("synthesizes cmodel from a sibling model_config", async () => {
    catalog([{
      key: "qoder-default",
      enable: false,
      display_name: "Sibling",
      max_input_tokens: 42,
      max_output_tokens: 7,
      is_vl: true,
      is_reasoning: true,
      description: "Sibling config",
      upstream_only: "kept",
    }]);

    const resolved = await resolveQoderModels(credentials);

    expect(resolved.models).toContainEqual(expect.objectContaining({
      id: "cmodel",
      name: "Cantus",
      contextLength: 42,
      maxOutputTokens: 7,
      isVL: true,
      isReasoning: true,
      description: "Sibling config",
    }));
    await expect(getQoderModelConfig(credentials, "cmodel")).resolves.toEqual({
      key: "cmodel",
      enable: false,
      display_name: "Cantus",
      max_input_tokens: 42,
      max_output_tokens: 7,
      is_vl: true,
      is_reasoning: true,
      description: "Sibling config",
      upstream_only: "kept",
    });
  });

  it("keeps upstream cmodel config unchanged", async () => {
    const upstreamCmodel = {
      key: "cmodel",
      enable: false,
      display_name: "Upstream Cantus",
      max_input_tokens: 99,
      max_output_tokens: 11,
      is_vl: true,
      is_reasoning: true,
      description: "Upstream config",
    };
    catalog([upstreamCmodel]);

    const resolved = await resolveQoderModels(credentials);

    expect(resolved.models).toEqual([]);
    await expect(getQoderModelConfig(credentials, "cmodel")).resolves.toEqual(upstreamCmodel);
  });

  it("uses upstream defaults when no sibling config exists", async () => {
    catalog([]);

    const resolved = await resolveQoderModels(credentials);

    expect(resolved.models).toContainEqual({
      id: "cmodel",
      name: "Cantus",
      contextLength: 131072,
      maxOutputTokens: 64000,
      isVL: false,
      isReasoning: false,
      description: "Qoder Cantus (C-model)",
    });
    await expect(getQoderModelConfig(credentials, "cmodel")).resolves.toEqual({
      key: "cmodel",
      enable: true,
      display_name: "Cantus",
      max_input_tokens: 131072,
      max_output_tokens: 64000,
      is_vl: false,
      is_reasoning: false,
      description: "Qoder Cantus (C-model)",
    });
  });
});
