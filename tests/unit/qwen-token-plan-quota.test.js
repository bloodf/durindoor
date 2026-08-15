import { describe, expect, it, vi } from "vitest";
import { getProviderQuotaAdapter } from "../../open-sse/services/quota/providers/index.js";
import {
  fetchBailianQuota,
  normalizeQwenTokenPlanQuota,
} from "../../open-sse/services/quota/providers/codingPlans.js";

const NOW = Date.parse("2026-08-15T00:00:00.000Z");
const RESET = "2026-08-15T01:00:00.000Z";

function gateway(payload) {
  return {
    code: "200",
    data: { DataV2: { data: { code: "SUCCESS", success: true, data: payload } } },
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function quotaContext(connection, fetchImpl) {
  const { config } = getProviderQuotaAdapter("bailian-coding-plan");
  return {
    config,
    connection,
    fetchImpl,
    signal: new AbortController().signal,
    now: () => NOW,
    timeoutMs: 1_000,
    maxResponseBytes: 64 * 1024,
  };
}

describe("Qwen / Alibaba personal Token Plan quota (port abd4df63dc25)", () => {
  it("normalizes every present personal-plan window without inventing a total", () => {
    const rows = normalizeQwenTokenPlanQuota(
      {
        usage: {
          per1WeekPercentage: 0.55,
          per1WeekResetTime: RESET,
          per5HourPercentage: 1,
          per5HourResetTime: RESET,
        },
        subscription: { specCode: "pro" },
        quotaConfig: { pro: { five_hour: 12_000, weekly: 40_000 } },
        consoleSite: "ALIYUN",
      },
      { now: NOW }
    );

    expect(rows).toHaveLength(2);
    const session = rows.find((r) => r.dimensionKey.endsWith(":session"));
    const weekly = rows.find((r) => r.dimensionKey.endsWith(":weekly"));
    expect(session).toMatchObject({
      state: "exhausted",
      amounts: expect.objectContaining({ limit: 12_000, used: 12_000, remaining: 0, unit: "requests" }),
    });
    expect(weekly).toMatchObject({
      state: "available",
      amounts: expect.objectContaining({ limit: 40_000, used: 22_000, remaining: 18_000, unit: "requests" }),
    });
  });

  it("rejects a personal-plan response whose tier quota is absent or malformed", () => {
    expect(normalizeQwenTokenPlanQuota({ usage: { per1WeekPercentage: 0.5 } }, { now: NOW })).toBeNull();
    expect(
      normalizeQwenTokenPlanQuota(
        { usage: { per1WeekPercentage: 0.5 }, subscription: { specCode: "pro" }, quotaConfig: { pro: { weekly: 0 } } },
        { now: NOW }
      )
    ).toBeNull();
    expect(
      normalizeQwenTokenPlanQuota(
        { usage: { per1WeekPercentage: 1.2 }, subscription: { specCode: "pro" }, quotaConfig: { pro: { weekly: 40_000 } } },
        { now: NOW }
      )
    ).toBeNull();
  });

  it("surfaces Token Plan quota via the console cookie gateway, not the inference API key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(gateway({ per1WeekPercentage: 0.25, per1WeekResetTime: RESET })))
      .mockResolvedValueOnce(json(gateway({ pro: { weekly: 40_000 } })))
      .mockResolvedValueOnce(json(gateway({ specCode: "pro" })));

    const result = await fetchBailianQuota(
      quotaContext(
        {
          id: "token-plan",
          provider: "bailian-coding-plan",
          apiKey: "enterprise-api-key",
          providerSpecificData: {
            qwenCloudCookie: "login_aliyunid_ticket=browser-session",
            qwenCloudSecToken: "sec",
            qwenCloudConsoleSite: "INTL",
          },
        },
        fetchImpl
      )
    );

    expect(result).toMatchObject({ outcome: "success", sourceId: "bailian-coding-plan:token-plan-quota:v1" });
    expect(result.rows).toHaveLength(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("bailian-singapore-cs.alibabacloud.com/data/api.json");
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Cookie: "login_aliyunid_ticket=browser-session" });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).params).toMatchObject({
      Api: "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
    });
  });

  it("falls back to retained API-key Coding Plan quota only when personal quota is unavailable", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ code: "ConsoleNeedLogin" }))
      .mockResolvedValueOnce(
        json({
          code: "Success",
          data: {
            codingPlanInstanceInfos: [
              {
                codingPlanQuotaInfo: {
                  per5HourUsedQuota: 1,
                  per5HourTotalQuota: 10,
                  per5HourQuotaNextRefreshTime: RESET,
                  perWeekUsedQuota: 2,
                  perWeekTotalQuota: 20,
                  perWeekQuotaNextRefreshTime: RESET,
                  perBillMonthUsedQuota: 3,
                  perBillMonthTotalQuota: 30,
                  perBillMonthQuotaNextRefreshTime: RESET,
                },
              },
            ],
          },
        })
      );

    const result = await fetchBailianQuota(
      quotaContext(
        {
          id: "coding-plan",
          provider: "bailian-coding-plan",
          apiKey: "enterprise-api-key",
          providerSpecificData: { qwenCloudCookie: "login_aliyunid_ticket=expired" },
        },
        fetchImpl
      )
    );

    expect(result).toMatchObject({ outcome: "success", sourceId: "bailian-coding-plan:console-quota:v1" });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer enterprise-api-key");
  });
});
