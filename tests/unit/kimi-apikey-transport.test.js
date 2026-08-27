// Kimi Code docs define separate subscription and Open Platform endpoints.
// Subscription transports support both protocols; platform API keys remain OpenAI-only.
import { describe, expect, it } from "vitest";
import { getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import kimi from "../../open-sse/providers/registry/kimi.js";

const SUBSCRIPTION_HOST = "api.kimi.com";
const PLATFORM_HOST = "api.moonshot.ai";

const DOCUMENTED_MODELS = ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"];
const LEGACY_MODELS = ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6-thinking", "moonshotai/kimi-k2.7-code"];
describe("kimi transports", () => {
  it("exposes a dedicated apikey transport pointing at the platform endpoint", () => {
    const transport = resolveTransport("kimi", "openai-apikey");

    expect(transport).toBeTruthy();
    expect(transport.baseUrl).toContain(PLATFORM_HOST);
    expect(transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("keeps the OAuth transports on the subscription endpoint", () => {
    expect(resolveTransport("kimi", "openai").baseUrl).toContain(SUBSCRIPTION_HOST);
    expect(resolveTransport("kimi", "claude").baseUrl).toContain(SUBSCRIPTION_HOST);
  });

  it("exposes only documented models and the documented k3[1m] inbound alias", () => {
    expect(kimi.models.map(({ id }) => id)).toEqual(DOCUMENTED_MODELS);
    expect(kimi.models.find(({ id }) => id === "k3")?.aliases).toEqual(["k3[1m]"]);
    expect(getModelUpstreamId("kimi", "k3[1m]")).toBe("k3");
    expect(isValidModel("kimi", "k3[1m]")).toBe(true);
    expect(isValidModel("kimi", "k3")).toBe(true);
    for (const legacyId of LEGACY_MODELS) {
      expect(isValidModel("kimi", legacyId)).toBe(false);
      expect(kimi.models.some(({ id, aliases }) => id === legacyId || aliases?.includes(legacyId))).toBe(false);
    }
  });

  it("keeps both protocol transports free of the retired beta query", () => {
    for (const format of ["claude", "openai"]) {
      const transport = resolveTransport("kimi", format);
      expect(transport.baseUrl).toContain(SUBSCRIPTION_HOST);
      expect(transport.urlSuffix).toBeUndefined();
    }
  });

  it("preserves raw x-api-key Claude auth and Bearer OpenAI auth", () => {
    expect(resolveTransport("kimi", "claude").auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
    expect(resolveTransport("kimi", "openai").auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  // The apikey transport is selected by a lookup tag, not a wire format. If that
  // tag ever leaked into targetFormat it would be handed to a translator that
  // has no such format registered.
  it("tags the apikey transport so it cannot be mistaken for a wire format", () => {
    const transport = resolveTransport("kimi", "openai-apikey");

    expect(transport.format).toBe("openai-apikey");
    expect(transport.format.replace(/-apikey$/, "")).toBe("openai");
  });

  it("does not add the platform endpoint to any other transport", () => {
    const platformTransports = kimi.transports.filter((t) => t.baseUrl.includes(PLATFORM_HOST));

    expect(platformTransports).toHaveLength(1);
    expect(platformTransports[0].format).toBe("openai-apikey");
  });
});
