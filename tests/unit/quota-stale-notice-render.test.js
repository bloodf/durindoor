// @vitest-environment happy-dom
/**
 * A rate-limited Claude card must render the cached rows AND say why they are
 * old. The renderer previously chose between `message` and the table, so any
 * response carrying a message replaced the whole table with a notice — the
 * blank card behind this bug.
 *
 * This guards the render branch specifically: a helper test cannot catch the
 * table being swapped back out for a message-only notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/quota", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/shared/utils/latestIntentQueue", () => ({ createLatestIntentQueue: () => ({ hydrate: () => {}, enqueue: async () => {} }) }));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_SUPPORTED_PROVIDERS: ["claude"], AI_PROVIDERS: {} }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: () => {} }) }));
vi.mock("@/shared/utils/codexPlanLabel", () => ({ getCodexPlan: () => null }));
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

const connections = [{ id: "claude-1", provider: "claude", name: "Claude Code", authType: "oauth", isActive: true }];

function mockFetch(usageBody) {
  globalThis.fetch = vi.fn((url, options) => {
    const target = String(url);
    if (target.startsWith("/api/settings")) {
      if (options?.method === "PATCH") return Promise.resolve(response({}));
      return Promise.resolve(response({ quotaTrackerState: {}, quotaVisibility: {}, claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} } }));
    }
    if (target.startsWith("/api/proxy-pools")) return Promise.resolve(response({ proxyPools: [] }));
    if (target.startsWith("/api/providers/client")) return Promise.resolve(response({
      connections,
      providerOptions: ["claude"],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      totals: { eligibleConnections: 1, providerFilteredConnections: 1 },
    }));
    if (target.startsWith("/api/usage/claude-1")) return Promise.resolve(response(usageBody));
    return Promise.resolve(response({}));
  });
}

describe("rate-limited Claude card", () => {
  let container;
  let root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderAndSettle = async () => {
    await act(async () => {
      root.render(React.createElement(ProviderLimits));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const quotaTable = () => container.querySelector('[data-testid="quota-table"]');

  it("shows the server's stale rows together with the reason", async () => {
    // Warm-cache 429: the server returns rows plus a staleReason.
    mockFetch({
      quotas: { "session (5h)": { used: 15, total: 100, remainingPercentage: 85 } },
      stale: true,
      rateLimited: true,
      staleReason: "Rate limited; showing cached quota.",
    });

    await renderAndSettle();

    // Both must be present — not one instead of the other.
    expect(container.textContent).toContain("Rate limited; showing cached quota.");
    expect(quotaTable()).not.toBeNull();
    expect(quotaTable().textContent).toContain("session (5h)");
  });

  it("substitutes browser-cached rows when a restart left the server with none", async () => {
    // Seed the browser cache as a previous successful poll would have.
    window.localStorage.setItem(
      "quotaCacheData",
      JSON.stringify({
        "claude-1": {
          quotas: [{ name: "weekly (7d)", used: 42, total: 100, remainingPercentage: 58 }],
          cachedAt: new Date().toISOString(),
        },
      }),
    );
    // Cold-start 429: in-process cache empty, so the server can only send a message.
    mockFetch({ message: "Rate limited, try again later." });

    await renderAndSettle();

    expect(quotaTable()).not.toBeNull();
    expect(quotaTable().textContent).toContain("weekly (7d)");
    // The reason is still surfaced, so stale numbers are not mistaken for live.
    expect(container.textContent).toContain("Rate limited, try again later.");
  });

  it("falls back to a message-only card when nothing is cached anywhere", async () => {
    mockFetch({ message: "Rate limited, try again later." });

    await renderAndSettle();

    expect(container.textContent).toContain("Rate limited, try again later.");
    expect(quotaTable()).toBeNull();
  });
});
