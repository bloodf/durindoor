import { describe, expect, it } from "vitest";
import {
  probeRegistryProvider,
  validateDevinCloudAgentProvider,
} from "../../src/app/api/providers/providerProbe.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// OmniRoute #6894 (diegosouzapw#6142): wire the Devin cloud-agent provider into
// the generic provider validation flow and the static model catalog, mirroring
// the `jules` cloud-agent pattern. `devin` has no chat transport
// (`transport: null`), so without the specialty validator the generic
// registry probe returns null and the route reports "Provider validation not
// supported".

const okResponse = () => ({ ok: true, status: 200, text: async () => "" });
const authFailResponse = (status) => ({ ok: false, status, text: async () => "unauthorized" });

describe("validateDevinCloudAgentProvider (OmniRoute #6894)", () => {
  it("accepts a key when Devin lists sessions (200)", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      return okResponse();
    };

    const result = await validateDevinCloudAgentProvider({ apiKey: "cog_token", fetcher });

    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.devin.ai/v1/sessions?limit=1");
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers.Authorization).toBe("Bearer cog_token");
  });

  it.each([401, 403])("rejects with Invalid API key on HTTP %i", async (status) => {
    const fetcher = async () => authFailResponse(status);
    const result = await validateDevinCloudAgentProvider({ apiKey: "bad", fetcher });
    expect(result).toMatchObject({ valid: false, status, error: "Invalid API key" });
  });

  it("rejects without leaking raw network error text on fetch failure", async () => {
    const fetcher = async () => {
      throw new Error("getaddrinfo ENOTFOUND secret.internal.host");
    };
    const result = await validateDevinCloudAgentProvider({ apiKey: "k", fetcher });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider unavailable - network request failed");
    expect(result.error).not.toContain("ENOTFOUND");
  });

  it("rejects on other non-OK statuses without treating them as auth failures", async () => {
    const fetcher = async () => ({ ok: false, status: 500, text: async () => "boom" });
    const result = await validateDevinCloudAgentProvider({ apiKey: "k", fetcher });
    expect(result).toMatchObject({ valid: false, status: 500 });
    expect(result.error).toBe("Provider validation failed (HTTP 500)");
  });
});

describe("devin provider wiring (OmniRoute #6894)", () => {
  it("routes the generic validation dispatcher through the specialty validator", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push(url);
      return okResponse();
    };

    const result = await probeRegistryProvider("devin", "cog_token", fetcher);

    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(calls).toEqual(["https://api.devin.ai/v1/sessions?limit=1"]);
  });

  it("returns Invalid API key through the dispatcher on 401", async () => {
    const result = await probeRegistryProvider("devin", "bad", async () => authFailResponse(401));
    expect(result).toMatchObject({ valid: false, status: 401, error: "Invalid API key" });
  });

  it("exposes a static model catalog via the real consumer path", () => {
    const models = getModelsByProviderId("devin");
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toMatchObject({ id: "devin", name: "Devin (Cognition cloud agent)" });
  });

  it("marks the placeholder model as toolless so combo never expects tool calls", () => {
    const caps = getCapabilitiesForModel("devin", "devin");
    expect(caps.tools).toBe(false);
  });

  it("keeps the ACP devin-cli provider out of the specialty dispatch", async () => {
    // devin-cli has a registry transport of devin://acp/stdio (non-HTTP); the
    // generic probe must still handle it (returns null → unsupported), proving
    // the specialty map is keyed exactly to the cloud-agent id.
    const result = await probeRegistryProvider("devin-cli", "token", async () => okResponse());
    expect(result).toBeNull();
  });
});
