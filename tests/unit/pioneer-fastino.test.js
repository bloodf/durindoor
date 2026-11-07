// Pioneer moved to Fastino (#1225). Unverified: live chat behaviour of the decoder IDs.
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("pioneer (Fastino) provider", () => {
  it("is registered on the Fastino host, not the retired Pioneer host", () => {
    expect(REGISTRY.some((e) => e.id === "pioneer")).toBe(true);
    expect(PROVIDERS.pioneer.baseUrl).toBe("https://api.fastino.ai/v1/chat/completions");
    expect(JSON.stringify(PROVIDERS.pioneer)).not.toContain("pioneer.ai");
  });

  it("lists only documented decoder models", () => {
    expect((PROVIDER_MODELS.pioneer || []).map((m) => m.id)).toEqual([
      "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4",
      "fastino/Fastino-Nemotron-3.5-Lightning-Finance",
      "fastino/Fastino-Nemotron-3.5-Lightning-Healthcare",
    ]);
  });

  it("does not collide with an existing alias", () => {
    expect(REGISTRY.filter((e) => (e.alias || e.id) === "pioneer")).toHaveLength(1);
  });
});
