import { describe, expect, it } from "vitest";

import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Qoder quota normalization", () => {
  it("shows zero-total organization usage with an inferred total", () => {
    expect(parseQuotaData("qoder", {
      quotas: {
        organization: {
          total: 0,
          used: 3804,
          remaining: 6196,
          unit: "credits",
          resetAt: "2026-07-31T16:00:00.000Z",
        },
      },
    })).toEqual([{
      name: "Organization",
      used: 3804,
      total: 10000,
      unit: "credits",
      resetAt: "2026-07-31T16:00:00.000Z",
    }]);
  });

  it("keeps an all-zero personal quota", () => {
    expect(parseQuotaData("qoder", {
      quotas: {
        user: {
          total: 0,
          used: 0,
          remaining: 0,
          unit: "credits",
        },
      },
    })).toEqual([{
      name: "Personal",
      used: 0,
      total: 0,
      unit: "credits",
      resetAt: null,
    }]);
  });

  it("skips an all-zero organization placeholder", () => {
    expect(parseQuotaData("qoder", {
      quotas: {
        organization: {
          total: 0,
          used: 0,
          remaining: 0,
          unit: "credits",
        },
      },
    })).toEqual([]);
  });
});
