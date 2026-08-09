// decolua/9router#3088 (upstream issue #2881) — a Kimi API-key connection must
// reach the OpenAI-compatible platform endpoint (api.moonshot.cn), not the Kimi
// Code subscription endpoint that OAuth connections use. The platform API speaks
// OpenAI only, so a Claude-format client has to be translated rather than passed
// through.
import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import kimi from "../../open-sse/providers/registry/kimi.js";

const SUBSCRIPTION_HOST = "api.kimi.com";
const PLATFORM_HOST = "api.moonshot.cn";

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
