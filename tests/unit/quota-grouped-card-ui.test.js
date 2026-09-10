// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/quota", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/shared/utils/latestIntentQueue", () => ({ createLatestIntentQueue: () => ({ hydrate: () => {}, enqueue: async () => {} }) }));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
// AI_PROVIDERS left empty so connection labels fall back to connection.name and
// the two Codex accounts stay distinguishable in assertions.
vi.mock("@/shared/constants/providers", () => ({ USAGE_SUPPORTED_PROVIDERS: ["codex"], AI_PROVIDERS: {} }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: () => {} }) }));
vi.mock("@/shared/utils/codexPlanLabel", () => ({ getCodexPlan: () => null }));
// QuotaTable renders its rows as JSON so merged-aggregation wiring is assertable.
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable", () => ({
  default: ({ quotas }) => React.createElement("div", { "data-testid": "quota-table" }, JSON.stringify(quotas)),
}));
vi.mock("@/shared/ui/components/Card.jsx", () => ({
  Card: ({ children, ...props }) => React.createElement("div", { ...props, className: "ds-card" }, children),
  CardHeader: ({ title, subtitle, actions }) => React.createElement("header", null, title, subtitle, actions),
  CardContent: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({ default: ({ children, ...props }) => React.createElement("button", props, children) }));
vi.mock("@/shared/ui/components/IconButton.jsx", () => ({ default: ({ label, ...props }) => React.createElement("button", { ...props, "aria-label": label }, label) }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: ({ options, value, onChange, ...props }) => React.createElement("select", { ...props, value, onChange: (event) => onChange(event.target.value) }, (options || []).map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/shared/ui/components/Input.jsx", () => ({ default: (props) => React.createElement("input", props) }));
vi.mock("@/shared/ui/components/Pagination.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/ProviderLogo.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({ default: ({ checked, onChange, ...props }) => React.createElement("button", { ...props, role: "switch", "aria-checked": String(checked), onClick: () => onChange?.(!checked) }) }));
vi.mock("@/shared/ui/components/Tooltip.jsx", () => ({ default: ({ children }) => children }));
vi.mock("@/shared/ui/components/EmptyState.jsx", () => ({ default: ({ title }) => React.createElement("div", null, title) }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children }) => open ? React.createElement("dialog", { open: true, "aria-label": title }, children) : null }));
vi.mock("@/shared/ui/components/DataTable.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/ConfirmDialog.jsx", () => ({ default: () => null }));

import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const connections = [
  { id: "codex-1", provider: "codex", name: "Codex One", authType: "oauth", isActive: true },
  { id: "codex-2", provider: "codex", name: "Codex Two", authType: "oauth", isActive: true },
];

describe("ProviderLimits provider grouping and merged view", () => {
  let container;
  let root;

  beforeEach(() => {
    window.localStorage.clear();
    globalThis.fetch = vi.fn((url, options) => {
      const target = String(url);
      if (target.startsWith("/api/settings")) {
        if (options?.method === "PATCH") return Promise.resolve(response({}));
        return Promise.resolve(response({ quotaTrackerState: {}, quotaVisibility: {}, claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} } }));
      }
      if (target.startsWith("/api/proxy-pools")) return Promise.resolve(response({ proxyPools: [] }));
      if (target.startsWith("/api/providers/client")) return Promise.resolve(response({
        connections,
        providerOptions: ["codex"],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        totals: { eligibleConnections: 2, providerFilteredConnections: 2 },
      }));
      if (target.startsWith("/api/usage/codex-1")) return Promise.resolve(response({ quotas: { primary: { used: 300, total: 1000, resetAt: "2026-09-10T00:00:00Z" } } }));
      if (target.startsWith("/api/usage/codex-2")) return Promise.resolve(response({ quotas: { primary: { used: 100, total: 1000, resetAt: "2026-09-12T00:00:00Z" } } }));
      return Promise.resolve(response({}));
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderAndSettle = async () => {
    await act(async () => {
      root.render(React.createElement(ProviderLimits));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const quotaTables = () => Array.from(container.querySelectorAll('[data-testid="quota-table"]'));

  it("renders one grouped provider card with one section per account", async () => {
    await renderAndSettle();

    // One provider card for both Codex accounts + one pagination footer card.
    expect(container.querySelectorAll(".ds-card")).toHaveLength(2);
    expect(container.textContent).toContain("2 accounts");
    expect(container.textContent).toContain("Codex One");
    expect(container.textContent).toContain("Codex Two");

    // Per-account view by default: one quota table per account, and per-account
    // actions stay available.
    expect(quotaTables()).toHaveLength(2);
    expect(container.querySelectorAll('button[aria-label="Delete connection"]')).toHaveLength(2);
    expect(container.querySelectorAll('button[aria-label="Refresh quota"]')).toHaveLength(2);

    const mergeToggle = container.querySelector('button[aria-label="Merge codex quotas across accounts"]');
    expect(mergeToggle).not.toBeNull();
    expect(mergeToggle.getAttribute("aria-checked")).toBe("false");
  });

  it("merges identical quotas across accounts when the toggle is enabled and persists the choice", async () => {
    await renderAndSettle();

    const mergeToggle = container.querySelector('button[aria-label="Merge codex quotas across accounts"]');
    await act(async () => {
      mergeToggle.click();
      await Promise.resolve();
    });

    expect(mergeToggle.getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem("quotaMergedProviders")).toBe(JSON.stringify({ codex: true }));

    const tables = quotaTables();
    expect(tables).toHaveLength(1);
    const mergedRows = JSON.parse(tables[0].textContent);
    expect(mergedRows).toHaveLength(1);
    expect(mergedRows[0].mergeMode).toBe("absolute");
    expect(mergedRows[0].used).toBe(400);
    expect(mergedRows[0].total).toBe(2000);
    expect(mergedRows[0].accountCount).toBe(2);
    // Soonest reset wins across accounts.
    expect(mergedRows[0].resetAt).toBe("2026-09-10T00:00:00.000Z");

    // Toggling back restores per-account sections and clears the preference.
    await act(async () => {
      mergeToggle.click();
      await Promise.resolve();
    });
    expect(quotaTables()).toHaveLength(2);
    expect(window.localStorage.getItem("quotaMergedProviders")).toBe(JSON.stringify({}));
  });
});
