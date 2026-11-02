/**
 * Port of decolua/9router b2aaf83b (#4758): surface Qoder add-on (free-credit
 * promo) quota and the year-9999 "never expires" sentinel in the quota tracker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

import { getQoderUsage } from "../../open-sse/services/usage/misc.js";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const SENTINEL = 253402214400000;

function respond(body) {
  mocks.proxyAwareFetch.mockResolvedValue({ ok: true, json: async () => body });
}

describe("getQoderUsage add-on quota", () => {
  beforeEach(() => mocks.proxyAwareFetch.mockReset());

  it("omits addOn when the account holds no grant", async () => {
    respond({ userQuota: { total: 10, used: 1, remaining: 9 }, orgResourcePackage: {}, addOnQuota: { total: 0 } });
    const { quotas } = await getQoderUsage("tok");
    expect(quotas).not.toHaveProperty("addOn");
  });

  it("surfaces addOn with a detail link and no reset date", async () => {
    respond({
      userQuota: {}, orgResourcePackage: {},
      addOnQuota: { total: 2200, used: 200, remaining: 2000, detailUrl: "https://qoder.com/usage" },
    });
    const { quotas } = await getQoderUsage("tok");
    expect(quotas.addOn).toEqual({
      total: 2200, used: 200, remaining: 2000, unit: "credits",
      resetAt: null, neverExpires: false, detailUrl: "https://qoder.com/usage",
    });
  });

  it("drops a non-https detailUrl (rendered as an href)", async () => {
    respond({ userQuota: {}, orgResourcePackage: {}, addOnQuota: { total: 5, detailUrl: "javascript:alert(1)" } });
    const { quotas } = await getQoderUsage("tok");
    expect(quotas.addOn.detailUrl).toBeNull();
  });

  it("flags the 9999 sentinel as neverExpires instead of a reset date", async () => {
    respond({ userQuota: { total: 1 }, orgResourcePackage: {}, expiresAt: SENTINEL });
    const { quotas } = await getQoderUsage("tok");
    expect(quotas.user).toMatchObject({ resetAt: null, neverExpires: true });
  });
});

describe("parseQuotaData qoder", () => {
  it("labels the add-on bucket and forwards neverExpires/detailUrl", () => {
    const rows = parseQuotaData("qoder", {
      quotas: {
        user: { total: 10, used: 1, remaining: 9, neverExpires: true },
        addOn: { total: 20, used: 2, remaining: 18, detailUrl: "https://qoder.com/usage" },
      },
    });
    expect(rows.map((r) => r.name)).toEqual(["Personal", "Add-on"]);
    expect(rows[0].neverExpires).toBe(true);
    expect(rows[1].detailUrl).toBe("https://qoder.com/usage");
  });
});
