import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { resolveKiroModels, clearKiroModelCache } = await import("../../open-sse/services/kiroModels.js");
const { KIRO_DEFAULT_PROFILE_ARNS } = await import("../../open-sse/config/kiroConstants.js");

const catalog = () => Response.json({ models: [{ modelId: "claude-sonnet-4.5" }] });
const load = (providerSpecificData) =>
  resolveKiroModels({ accessToken: "kiro-test-token", providerSpecificData });
const sentArn = (call = 0) =>
  new URL(proxyAwareFetch.mock.calls[call][0]).searchParams.get("profileArn");

beforeEach(() => {
  clearKiroModelCache();
  proxyAwareFetch.mockReset();
  proxyAwareFetch.mockImplementation(async () => catalog());
});

describe("OmniRoute #19626 Kiro catalog profileArn", () => {
  it.each([
    [{ authMethod: "builder-id" }, KIRO_DEFAULT_PROFILE_ARNS["builder-id"]],
    [{ authMethod: "google" }, KIRO_DEFAULT_PROFILE_ARNS.social],
    [{ authMethod: "github" }, KIRO_DEFAULT_PROFILE_ARNS.social],
    [{ authMethod: "imported", provider: "Google" }, KIRO_DEFAULT_PROFILE_ARNS.social],
  ])("sends the shared ARN for %j", async (psd, arn) => {
    expect((await load(psd)).models.length).toBeGreaterThan(0);
    expect(sentArn()).toBe(arn);
  });

  it("keeps a stored profileArn", async () => {
    const profileArn = "arn:aws:codewhisperer:eu-central-1:111111111111:profile/OWN";
    await load({ authMethod: "google", profileArn });
    expect(sentArn()).toBe(profileArn);
  });

  it.each([
    { authMethod: "idc" },
    { authMethod: "external_idp" },
    { authMethod: "api_key" },
    { authMethod: "imported" },
    { authMethod: "builder-id", region: "eu-central-1" },
  ])("sends no shared ARN for %j", async (psd) => {
    await load(psd);
    expect(sentArn()).toBeNull();
  });

  it("falls back to the origin-only call when the shared ARN is rejected", async () => {
    proxyAwareFetch.mockImplementationOnce(async () => new Response("Invalid profileArn.", { status: 400 }));
    expect((await load({ authMethod: "builder-id" })).models.length).toBeGreaterThan(0);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(sentArn(1)).toBeNull();
  });
});
