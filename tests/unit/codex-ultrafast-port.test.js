import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";

describe("Codex connection Ultrafast", () => {
  const executor = new CodexExecutor();
  const send = (model, tier, enabled = true) => executor.transformRequest(model, { model, input: "hi", ...(tier === undefined ? {} : { service_tier: tier }) }, true, { providerSpecificData: { codexUltrafastMode: enabled } });
  it("only enables the tier on opted-in Sol connections", () => {
    expect(send("gpt-6.2-sol").service_tier).toBe("ultrafast");
    expect(send("gpt-6.2-astra").service_tier).toBeUndefined();
    expect(send("gpt-6.2-sol", undefined, false).service_tier).toBeUndefined();
    expect(send("gpt-6.2-sol", "priority").service_tier).toBe("priority");
    expect(send("gpt-6.2-sol", "default").service_tier).toBeUndefined();
  });
  it("returns the toggle state to the dashboard without exposing secrets", () => {
    expect(sanitizeProviderConnectionForClient({ provider: "codex", providerSpecificData: { codexUltrafastMode: true, secret: "hidden" } }).providerSpecificData).toEqual({ codexUltrafastMode: true });
  });
});
