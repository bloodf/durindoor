// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/usage", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/shared/utils/latestIntentQueue", () => ({ createLatestIntentQueue: () => ({ hydrate: () => {}, enqueue: async () => {} }) }));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_SUPPORTED_PROVIDERS: [], AI_PROVIDERS: { codex: { name: "OpenAI Codex" } } }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: () => {} }) }));
vi.mock("@/shared/utils/codexPlanLabel", () => ({ getCodexPlan: () => "Pro" }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable", () => ({ default: () => React.createElement("div", null, "quota rows") }));
vi.mock("@/shared/ui/components/Card.jsx", () => ({ Card: ({ children }) => React.createElement("section", null, children), CardHeader: ({ title, actions }) => React.createElement("header", null, title, actions), CardContent: ({ children }) => React.createElement("div", null, children) }));
vi.mock("@/shared/ui/components/Button.jsx", () => ({ default: ({ children, ...props }) => React.createElement("button", props, children) }));
vi.mock("@/shared/ui/components/IconButton.jsx", () => ({ default: ({ label, ...props }) => React.createElement("button", { ...props, "aria-label": label }, label) }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: ({ options, value, onChange, ...props }) => React.createElement("select", { ...props, value, onChange: (event) => onChange(event.target.value) }, options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/shared/ui/components/Input.jsx", () => ({ default: (props) => React.createElement("input", props) }));
vi.mock("@/shared/ui/components/Pagination.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/ProviderLogo.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({ default: ({ checked, onChange }) => React.createElement("button", { role: "switch", "aria-checked": checked, onClick: () => onChange(!checked) }) }));
vi.mock("@/shared/ui/components/Tooltip.jsx", () => ({ default: ({ children }) => children }));
vi.mock("@/shared/ui/components/EmptyState.jsx", () => ({ default: ({ title }) => React.createElement("div", null, title) }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children }) => open ? React.createElement("dialog", { open: true, "aria-label": title }, children) : null }));
vi.mock("@/shared/ui/components/DataTable.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/ConfirmDialog.jsx", () => ({ default: ({ open, title, message, onConfirm }) => open ? React.createElement("dialog", { open: true, "aria-label": title }, React.createElement("p", null, message), React.createElement("button", { onClick: onConfirm }, "Confirm")) : null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js", async (importOriginal) => ({
  QUOTA_CACHE_KEY: "quotaCacheData", REFRESH_INTERVAL_MS: 300000, CLAUDE_REFRESH_INTERVAL_MS: 600000, DEPLETED_QUOTA_THRESHOLD: 5, AUTO_REFRESH_STORAGE_KEY: "quotaAutoRefresh", CONNECTIONS_PAGE_SIZE: 20, ACCOUNT_PAGE_SIZE_OPTIONS: [10, 20], ACCOUNT_PAGE_SIZE_MAX: 500, ACCOUNT_FILTER_OPTIONS: [{ value: "all", label: "All accounts" }], QUOTA_SORT_OPTIONS: [{ value: "default", label: "Default" }],
  parseQuotaData: () => [], calculatePercentage: () => 100, filterQuotasByVisibility: () => [], getHiddenQuotaRows: () => [], getQuotaVisibilityKey: () => "quota", updateQuotaVisibility: (state) => state, getConnectionLabel: (await importOriginal()).getConnectionLabel, sortVisibleConnections: (connections) => connections, buildLoadingState: () => ({}), getRefreshConnections: (connections) => connections, filterQuotaStateByConnections: (state) => state, getConnectionsEmptyMessage: () => ({ icon: "filter_alt", title: "No matching providers", description: "Try another filter." }), getPageSizeLabel: () => "", getConnectionsPaginationSummary: () => "1 result", getSafePagination: (value) => value, getSafeTotals: (value) => value, shouldResetPage: () => false, getPaginationPageValue: (value) => value.page, getProviderOptions: (value) => value || [], reconcileConnectionsPage: async (fetchConnections) => fetchConnections(), getQuotaCache: () => ({}), setQuotaCache: () => {}, createAutoRefreshScheduler: () => ({ start: () => {}, stop: () => {} }), refreshProviderQuotas: async () => {},
}));

import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";

const response = (body) => ({ ok: true, status: 200, json: async () => body });

describe("ProviderLimits delete confirmation", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.fetch = vi.fn((url) => {
      if (String(url).startsWith("/api/settings")) return Promise.resolve(response({ quotaTrackerState: {}, quotaVisibility: {} }));
      if (String(url).startsWith("/api/proxy-pools")) return Promise.resolve(response({ proxyPools: [] }));
      if (String(url).startsWith("/api/providers/client")) return Promise.resolve(response({ connections: [{ id: "codex-1", provider: "codex", name: "Production account", authType: "oauth", isActive: true }], providerOptions: ["codex"], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, totals: { eligibleConnections: 1, providerFilteredConnections: 1 } }));
      if (String(url).startsWith("/api/usage/")) return Promise.resolve(response({ resetCredits: { availableCount: 0 } }));
      return Promise.resolve(response({}));
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("requires DS confirmation before destructive provider deletion", async () => {
    await act(async () => { root.render(React.createElement(ProviderLimits)); await Promise.resolve(); await Promise.resolve(); });
    const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Delete connection");
    expect(deleteButton).toBeDefined();
    await act(async () => { deleteButton.click(); });
    expect(container.querySelector('dialog[aria-label="Delete connection?"]')).not.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/providers/codex-1", expect.objectContaining({ method: "DELETE" }));
  });
});
