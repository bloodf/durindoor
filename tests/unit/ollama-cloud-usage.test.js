// Port of OmniRoute #7054: Ollama Cloud must be registered for usage fetching.
// OmniRoute adds "ollama-cloud" to USAGE_FETCHER_PROVIDERS; durindoor's equivalent
// is the registry `features.usageApikey` flag (USAGE_APIKEY_PROVIDERS is derived
// from it), because cloud connections authenticate with an API key and the
// /api/usage/[connectionId] route rejects apikey providers not in that list.
import { describe, it, expect, vi } from "vitest";

// Cloud usage now performs a real HTTP read (ported from decolua/9router
// f260a181), so the dispatcher assertions below must stay offline: mock the
// transport rather than letting the unit gate reach ollama.com.
const proxyMock = vi.hoisted(() => ({ impl: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => proxyMock.impl(...args),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";

describe("ollama cloud usage registration (#7054)", () => {
  it("cloud registry entry exposes usage + usageApikey", () => {
    const cloud = REGISTRY.find((r) => r.id === "ollama");
    expect(cloud, "ollama cloud registry entry").toBeTruthy();
    expect(cloud.features?.usage).toBe(true);
    expect(cloud.features?.usageApikey).toBe(true);
  });

  it("cloud is in both derived usage lists", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("ollama");
    expect(USAGE_APIKEY_PROVIDERS).toContain("ollama");
  });

  it("local ollama stays unregistered", () => {
    const local = REGISTRY.find((r) => r.id === "ollama-local");
    expect(local, "ollama-local registry entry").toBeTruthy();
    expect(local.features?.usage).toBeFalsy();
    expect(local.features?.usageApikey).toBeFalsy();
    expect(USAGE_SUPPORTED_PROVIDERS).not.toContain("ollama-local");
    expect(USAGE_APIKEY_PROVIDERS).not.toContain("ollama-local");
  });

  // The dispatcher must forward the connection's apiKey and proxy options to
  // the usage handler; passing accessToken (the pre-port shape) would send an
  // undefined key and silently degrade to the "not available" branch.
  it("dispatcher forwards apiKey and proxy options to the cloud usage handler", async () => {
    const calls = [];
    proxyMock.impl = async (url, init, proxyOptions) => {
      calls.push({ url: String(url), auth: init?.headers?.Authorization, proxyOptions });
      if (String(url).includes("/api/usage")) {
        return new Response(JSON.stringify({ limits: { session: { usage: 0.25 }, weekly: { usage: 0.5 } } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ Plan: "pro" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    // proxyOptions is getUsageForProvider's second argument, not a connection field.
    const usage = await getUsageForProvider(
      { provider: "ollama", apiKey: "test-key" },
      { disableEnvProxy: true },
    );
    expect(calls[0].url).toContain("ollama.com/api/usage");
    expect(calls[0].auth).toBe("Bearer test-key");
    expect(calls[0].proxyOptions).toEqual({ disableEnvProxy: true });
    expect(usage.plan).toBe("Pro");
    expect(usage.quotas["Session (5h)"]).toMatchObject({ used: 25, total: 100, remainingPercentage: 75 });
    expect(usage.quotas["Weekly (7d)"]).toMatchObject({ used: 50, total: 100, remainingPercentage: 50 });
  });

  it("returns a fail-open message when the usage API rejects the key", async () => {
    proxyMock.impl = async () => new Response("nope", { status: 401 });

    const { getOllamaUsage } = await import("../../open-sse/services/usage/misc.js");
    const usage = await getOllamaUsage("bad-key", {});

    expect(usage).toEqual({ message: "Ollama Cloud API key invalid or expired." });
  });

  it("reports a clear message when no API key is available", async () => {
    const { getOllamaUsage } = await import("../../open-sse/services/usage/misc.js");
    const usage = await getOllamaUsage(null, {});

    expect(usage).toEqual({ message: "Ollama Cloud API key not available." });
  });
});
