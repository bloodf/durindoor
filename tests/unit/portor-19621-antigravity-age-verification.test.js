import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { getProjectIdForConnection, removeConnection } = await import("../../open-sse/services/projectId.js");
const { antigravityAgeRestrictionError, ANTIGRAVITY_AGE_VERIFICATION_URL } =
  await import("../../open-sse/services/antigravityProvisioning.js");

const ageRestricted = {
  allowedTiers: [{ id: "standard-tier", isDefault: true, userDefinedCloudaicompanionProject: true }],
  ineligibleTiers: [{ tierId: "free-tier", reasonCode: "RESTRICTED_AGE", reasonMessage: "Must be 18" }],
};

beforeEach(() => proxyAwareFetch.mockReset());
afterEach(() => removeConnection("age-conn"));

describe("OmniRoute #19621 Antigravity age verification", () => {
  it.each(["antigravity", "agy"])("explains the challenge and does not onboard (%s)", async (provider) => {
    proxyAwareFetch.mockResolvedValue(Response.json(ageRestricted));
    const error = await getProjectIdForConnection("age-conn", "ag-test-token", null, null, provider)
      .then(() => null, (caught) => caught);
    expect(error?.message).toContain("age verification");
    expect(error.message).toContain(ANTIGRAVITY_AGE_VERIFICATION_URL);
    expect(error).toMatchObject({ status: 403, credentialScoped: true });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(String(proxyAwareFetch.mock.calls[0][0])).toContain(":loadCodeAssist");
  });

  it("keeps a project the account already has", async () => {
    proxyAwareFetch.mockResolvedValue(Response.json({ ...ageRestricted, cloudaicompanionProject: "project-1" }));
    await expect(getProjectIdForConnection("age-conn", "ag-test-token", null, null, "antigravity"))
      .resolves.toBe("project-1");
  });

  it("allows onboarding when a managed default tier remains or the reason differs", () => {
    expect(antigravityAgeRestrictionError({ ...ageRestricted, allowedTiers: [{ id: "free-tier", isDefault: true }] })).toBeNull();
    expect(antigravityAgeRestrictionError({ ineligibleTiers: [{ reasonCode: "UNSUPPORTED_LOCATION" }] })).toBeNull();
    expect(antigravityAgeRestrictionError({})).toBeNull();
  });
});
