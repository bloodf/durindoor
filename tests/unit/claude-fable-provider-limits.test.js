// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import accountA from "./fixtures/claude-usage-account-a.json";
import accountB from "./fixtures/claude-usage-account-b.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/usage", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/shared/utils/latestIntentQueue", () => ({ createLatestIntentQueue: () => ({ hydrate: () => {}, enqueue: async () => {} }) }));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_SUPPORTED_PROVIDERS: ["claude"], AI_PROVIDERS: {} }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: () => {} }) }));

import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const connections = [
  { id: "claude-a", provider: "claude", name: "Account A", authType: "oauth", isActive: true },
  { id: "claude-b", provider: "claude", name: "Account B", authType: "oauth", isActive: true },
];
const response = (body) => ({ ok: true, status: 200, json: async () => body });

describe("Claude weekly window rows in ProviderLimits", () => {
  let container;
  let root;
  let usageB;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("quotaAutoRefresh", "false");
    usageB = accountB;
    vi.stubGlobal("fetch", vi.fn((url) => {
      const target = String(url);
      if (target.startsWith("/api/settings")) return Promise.resolve(response({
        quotaTrackerState: {},
        // A saved preference must not hide an unreported placeholder. Claude
        // persists modelKey/name identities, not positional name::index keys.
        quotaVisibility: { "claude-b": { hidden: ["weekly fable (7d)"] } },
        claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} },
      }));
      if (target.startsWith("/api/proxy-pools")) return Promise.resolve(response({ proxyPools: [] }));
      if (target.startsWith("/api/providers/client")) return Promise.resolve(response({
        connections, providerOptions: ["claude"],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        totals: { eligibleConnections: 2, providerFilteredConnections: 2 },
      }));
      if (target.startsWith("/api/usage/claude-a")) return Promise.resolve(response(accountA));
      if (target.startsWith("/api/usage/claude-b")) return Promise.resolve(response(usageB));
      return Promise.resolve(response({}));
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => { root.render(React.createElement(ProviderLimits)); });
  }

  function accountSection(name) {
    return within(container).getByText(name).closest("section");
  }

  it("shows real and unreported Fable rows without fabricating quota or allowing placeholder hiding", async () => {
    await render();
    const a = within(accountSection("Account A"));
    const b = within(accountSection("Account B"));
    const rowA = a.getByText("weekly fable (7d)").closest("tr");
    const rowB = b.getByText("weekly fable (7d)").closest("tr");
    expect(within(rowA).getByText("100%")).toBeDefined();
    expect(within(rowB).getByText("—")).toBeDefined();
    expect(within(rowB).getByText("not reported")).toBeDefined();
    expect(within(rowB).queryByRole("progressbar")).toBeNull();
    expect(within(rowB).queryByRole("button", { name: /Hide quota/ })).toBeNull();
    expect(b.getByText("weekly fable (7d)").title).toBe("Anthropic did not report this window for this account");
    expect(a.getByText("Rate limited; showing cached quota.")).toBeDefined();
    expect(b.queryByText("Rate limited; showing cached quota.")).toBeNull();
  });

  it("refreshes just the selected account and replaces the placeholder with newly reported quota", async () => {
    await render();
    usageB = { ...accountB, quotas: { ...accountB.quotas, "weekly fable (7d)": {
      used: 35, total: 100, remainingPercentage: 65, resetAt: "2030-01-08T00:00:00.000Z",
    } } };
    // The saved visibility preference still hides a newly reported row. Clear
    // it through the existing Show action, not through the placeholder contract.
    const b = within(accountSection("Account B"));
    const refresh = b.getByRole("button", { name: "Refresh quota" });
    expect(refresh.title).toBe("Refresh (bypass cache)");
    fetch.mockClear();
    await act(async () => { refresh.click(); });
    expect(fetch).toHaveBeenCalledWith("/api/usage/claude-b?refresh=1");
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/usage/claude-a"));
    expect(within(accountSection("Account B")).queryByText("not reported")).toBeNull();
    const show = within(accountSection("Account B")).getByRole("button", { name: "weekly fable (7d)" });
    expect(within(accountSection("Account B")).queryByRole("row", { name: /weekly fable \(7d\)/ })).toBeNull();
    await act(async () => { show.click(); });
    const table = within(accountSection("Account B")).getByRole("table", { name: "Provider quotas" });
    const row = await within(table).findByRole("row", { name: /weekly fable \(7d\)/ });
    expect(within(row).getByText("65%")).toBeDefined();
    expect(within(row).getByRole("button", { name: "Hide quota weekly fable (7d)" })).toBeDefined();
    expect(within(accountSection("Account B")).queryByRole("button", { name: "weekly fable (7d)" })).toBeNull();
    await act(async () => {
      within(row).getByRole("button", { name: "Hide quota weekly fable (7d)" }).click();
    });
    expect(within(accountSection("Account B")).queryByRole("row", { name: /weekly fable \(7d\)/ })).toBeNull();
    expect(within(accountSection("Account B")).getByRole("button", { name: "weekly fable (7d)" })).toBeDefined();
  });

  it("does not merge unreported placeholders as zero or fully available quota", async () => {
    await render();
    await act(async () => { within(container).getByRole("switch", { name: "Merge claude quotas across accounts" }).click(); });
    const row = within(container).getByText("weekly fable (7d)").closest("tr");
    expect(within(row).getByText("100%")).toBeDefined();
    expect(within(row).getByText("merged across 1 account")).toBeDefined();
  });
});
