// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/dashboard/usage",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/utils/latestIntentQueue", () => ({
  createLatestIntentQueue: () => ({ hydrate: () => {}, enqueue: async () => {} }),
}));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: () => {} }) }));
vi.mock("@/shared/utils/codexPlanLabel", () => ({ getCodexPlan: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable", () => ({
  default: ({ quotas }) => React.createElement("div", { "data-quota-count": quotas.length }),
}));

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
const {
  getEarliestQuotaResetTime,
  getQuotaAvailability,
  parseQuotaData,
  sortVisibleConnections,
} = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
const { default: ProviderLimits } = await import(
  "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js"
);

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Unreported Ollama Cloud quota availability and sorting (upstream PR #5898)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies unreported Ollama Cloud usage as unknown with infinite reset time", async () => {
    vi.stubGlobal("fetch", vi.fn());
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ activity: {}, limits: {} }))
      .mockResolvedValueOnce(jsonResponse({ Plan: "free" }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "test-key",
      providerSpecificData: {},
    });

    expect(usage.quotas).toEqual({});
    const rows = parseQuotaData("ollama", usage);
    expect(getQuotaAvailability(rows)).toBe("unknown");
    expect(getEarliestQuotaResetTime(rows)).toBe(Number.POSITIVE_INFINITY);
  });

  it("distinguishes unknown, depleted, and available quotas and preserves undated order", () => {
    const unknownZ = { id: "unknown-z", provider: "ollama", name: "Z" };
    const unknownA = { id: "unknown-a", provider: "ollama", name: "A" };
    const depleted = { id: "depleted", provider: "ollama", name: "B" };
    const available = { id: "available", provider: "ollama", name: "C" };
    const quotas = {
      "unknown-z": { quotas: [] },
      "unknown-a": { quotas: [{ used: 0, total: 0 }] },
      depleted: { quotas: [{ used: 100, total: 100, resetAt: "2026-11-28T00:00:00Z" }] },
      available: { quotas: [{ used: 0, total: 100, resetAt: "2026-11-27T00:00:00Z" }] },
    };

    expect(getQuotaAvailability(quotas["unknown-z"].quotas)).toBe("unknown");
    expect(getQuotaAvailability(quotas["unknown-a"].quotas)).toBe("unknown");
    expect(getQuotaAvailability([{ name: "Spent (7d)", used: 0, total: 10, isSpend: true }])).toBe("unknown");
    expect(getQuotaAvailability([{ name: "Est", used: 60, total: 60, remainingPercentage: 0, isEstimate: true }])).toBe("unknown");
    expect(getQuotaAvailability(quotas.depleted.quotas)).toBe("depleted");
    expect(getQuotaAvailability(quotas.available.quotas)).toBe("available");
    expect(getQuotaAvailability([{ unlimited: true }])).toBe("available");

    expect(
      sortVisibleConnections([unknownZ, depleted, unknownA, available], quotas, true, "ollama", "default"),
    ).toEqual([available, depleted, unknownZ, unknownA]);
  });

  it("excludes unknown-quota accounts from bulk Enable available and Disable empty actions", async () => {
    const putCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        const target = String(url);
        if (init.method === "PUT" && target.startsWith("/api/providers/")) {
          putCalls.push({ url: target, body: JSON.parse(init.body) });
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        if (target.startsWith("/api/settings")) {
          return { ok: true, status: 200, json: async () => ({ quotaTrackerState: {}, quotaVisibility: {} }) };
        }
        if (target.startsWith("/api/proxy-pools")) {
          return { ok: true, status: 200, json: async () => ({ proxyPools: [] }) };
        }
        if (target.startsWith("/api/providers/client")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              connections: [
                { id: "ollama-unknown-off", provider: "ollama", name: "Unknown Off", authType: "apikey", isActive: false },
                { id: "ollama-avail-off", provider: "ollama", name: "Avail Off", authType: "apikey", isActive: false },
                { id: "ollama-empty-on", provider: "ollama", name: "Empty On", authType: "apikey", isActive: true },
              ],
              providerOptions: ["ollama"],
              pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
              totals: { eligibleConnections: 3, providerFilteredConnections: 3 },
            }),
          };
        }
        if (target.startsWith("/api/usage/ollama-unknown-off")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ plan: "Free", message: "Ollama Cloud connected. No usage reported for this period.", quotas: {} }),
          };
        }
        if (target.startsWith("/api/usage/ollama-avail-off")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ plan: "Max", quotas: { "Session (5h)": { used: 10, total: 100, remainingPercentage: 90 } } }),
          };
        }
        if (target.startsWith("/api/usage/ollama-empty-on")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ plan: "Max", quotas: { "Session (5h)": { used: 100, total: 100, remainingPercentage: 0 } } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(ProviderLimits));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const buttons = Array.from(container.querySelectorAll("button"));
      const enableBtn = buttons.find((button) => button.textContent?.includes("Enable available"));
      const disableBtn = buttons.find((button) => button.textContent?.includes("Disable empty"));
      const expiringBtn = buttons.find((button) => button.textContent?.includes("Expiring"));

      expect(expiringBtn?.disabled).toBe(true);
      expect(enableBtn?.disabled).toBe(false);
      expect(disableBtn?.disabled).toBe(false);

      await act(async () => {
        enableBtn.click();
      });
      expect(putCalls).toEqual([{ url: "/api/providers/ollama-avail-off", body: { isActive: true } }]);

      putCalls.length = 0;
      await act(async () => {
        disableBtn.click();
      });
      expect(putCalls).toEqual([{ url: "/api/providers/ollama-empty-on", body: { isActive: false } }]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
