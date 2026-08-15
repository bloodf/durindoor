// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
const refreshNow = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/usage",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/shared/utils/latestIntentQueue", () => ({
  createLatestIntentQueue: () => ({ enqueue: (value) => value, reset: () => {} }),
}));

vi.mock("@/shared/components/ProviderIcon", () => ({
  default: function ProviderIcon() {
    return React.createElement("span", { "data-icon": "provider" });
  },
}));

vi.mock("@/shared/components/Badge", () => ({
  default: function Badge({ children }) {
    return React.createElement("span", { className: "badge" }, children);
  },
}));

vi.mock("@/shared/components/Toggle", () => ({
  default: function Toggle({ checked, onChange }) {
    return React.createElement("input", {
      type: "checkbox",
      checked,
      onChange: (event) => onChange?.(event.target.checked),
    });
  },
}));

vi.mock("@/shared/components/Tooltip", () => ({
  default: function Tooltip({ children }) {
    return children;
  },
}));

vi.mock("@/shared/components/Card", () => ({
  default: function Card({ children }) {
    return React.createElement("div", { className: "card" }, children);
  },
}));

vi.mock("@/shared/components", () => ({
  ConfirmModal: () => null,
  EditConnectionModal: () => null,
}));

vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => [null, () => {}],
}));

vi.mock("@/shared/constants/providers", () => ({
  USAGE_SUPPORTED_PROVIDERS: ["claude", "openai"],
  AI_PROVIDERS: {
    claude: { name: "Claude" },
    openai: { name: "OpenAI" },
  },
}));

vi.mock("@/shared/utils/codexPlanLabel", () => ({
  getCodexPlan: () => null,
}));

vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js", () => ({
  default: function QuotaTable() {
    return React.createElement("div", { "data-quota-table": "stub" });
  },
}));

vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js", () => ({
  QUOTA_CACHE_KEY: "quotaCacheData",
  REFRESH_INTERVAL_MS: 60000,
  CLAUDE_REFRESH_INTERVAL_MS: 600000,
  DEPLETED_QUOTA_THRESHOLD: 5,
  AUTO_REFRESH_STORAGE_KEY: "quotaAutoRefresh",
  CONNECTIONS_PAGE_SIZE: 20,
  ACCOUNT_PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  ACCOUNT_PAGE_SIZE_MAX: 500,
  ACCOUNT_FILTER_OPTIONS: [],
  QUOTA_SORT_OPTIONS: [],
  parseQuotaData: (data) => data,
  filterQuotasByVisibility: () => [],
  calculatePercentage: () => 0,
  getHiddenQuotaRows: () => [],
  getQuotaVisibilityKey: () => "",
  updateQuotaVisibility: () => {},
  getConnectionLabel: (connection) => connection?.name ?? null,
  getConnectionQuotaRemaining: () => Number.POSITIVE_INFINITY,
  sortVisibleConnections: (connections) => connections,
  buildLoadingState: () => ({}),
  getRefreshConnections: (connections) => connections,
  filterQuotaStateByConnections: () => ({}),
  getConnectionsEmptyMessage: () => "",
  getPageSizeLabel: () => "",
  getConnectionsPaginationSummary: () => "",
  getSafePagination: (value) => value ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  getSafeTotals: (value) => value ?? { eligibleConnections: 0, providerFilteredConnections: 0 },
  getPaginationPageValue: () => 1,
  getProviderOptions: () => [],
  reconcileConnectionsPage: (value) => value,
  getQuotaCache: () => null,
  setQuotaCache: () => {},
  createAutoRefreshScheduler: ({ onRefresh }) => ({
    refreshNow: () => refreshNow(onRefresh(true)),
    start: () => {},
    stop: () => {},
  }),
  refreshProviderQuotas: async (connections, force, fetchQuota) => {
    for (const connection of connections) {
      await fetchQuota(connection.id, connection.provider, { force });
    }
  },
}));

const jsonResponse = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";

describe("ProviderLimits Refresh All manual button", () => {
  let container;
  let root;

  beforeEach(() => {
    fetchMock.mockReset();
    refreshNow.mockClear();
    fetchMock.mockImplementation((url) => {
      if (typeof url === "string" && url.startsWith("/api/providers/client")) {
        return Promise.resolve(jsonResponse({ connections: [
          { id: "claude-1", provider: "claude" },
          { id: "openai-1", provider: "openai" },
        ], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 }, totals: { eligibleConnections: 2, providerFilteredConnections: 2 } }));
      }
      if (typeof url === "string" && url.startsWith("/api/proxy-pools")) {
        return Promise.resolve(jsonResponse({ proxyPools: [] }));
      }
      if (typeof url === "string" && url.startsWith("/api/usage/")) {
        return Promise.resolve(jsonResponse({ quotas: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = fetchMock;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("emits ?force=1 on every quota fetch when the manual Refresh All button is clicked", async () => {
    await act(async () => {
      root.render(React.createElement(ProviderLimits));
    });
    // Let the mount-time initial fetch settle so the refresh button observes a non-loading state.
    await act(async () => {
      await Promise.resolve();
    });

    fetchMock.mockClear();

    const refreshAllButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("title") === "Refresh all",
    );
    expect(refreshAllButton).toBeDefined();
    expect(refreshNow).not.toHaveBeenCalled();

    await act(async () => {
      refreshAllButton.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshNow).toHaveBeenCalledTimes(1);
    const quotaCalls = fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => typeof url === "string" && url.startsWith("/api/usage/"));
    expect(quotaCalls.length).toBeGreaterThan(0);
    for (const url of quotaCalls) {
      expect(url).toContain("?force=1");
    }
   });

  it("omits ?force=1 on the initial quota fetch when the dashboard mounts", async () => {
    await act(async () => {
      root.render(React.createElement(ProviderLimits));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const quotaCalls = fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => typeof url === "string" && url.startsWith("/api/usage/"));
    expect(quotaCalls.length).toBeGreaterThan(0);
    for (const url of quotaCalls) {
      expect(url).not.toContain("?force=1");
    }
   });
 });
