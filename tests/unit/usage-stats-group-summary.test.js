// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/components/Badge", () => ({
  default: ({ children }) => React.createElement("span", { "data-badge": true }, children),
}));
vi.mock("@/shared/components/Card", () => ({ default: ({ children }) => React.createElement("div", null, children) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageChart", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestsPanel", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({
  fmt: String,
  fmtTime: String,
  default: ({ tableType, groupedData, renderSummaryCells }) => React.createElement(
    "table",
    { "data-table": tableType },
    React.createElement("tbody", null, groupedData.map((group) => React.createElement(
      "tr",
      { key: group.groupKey, "data-group": group.groupKey },
      React.createElement("td", null, group.groupKey),
      renderSummaryCells(group),
    ))),
  ),
}));

import UsageStats from "@/shared/components/UsageStats.js";

const item = (overrides) => ({
  requests: 1,
  promptTokens: 1,
  completionTokens: 1,
  cost: 0,
  lastUsed: "2026-08-21T00:00:00.000Z",
  ...overrides,
});

const stats = {
  totalRequests: 9,
  byModel: {
    one: item({ rawModel: "unique-model", provider: "model-provider" }),
    twoA: item({ rawModel: "shared-model", provider: "model-provider-a" }),
    twoB: item({ rawModel: "shared-model", provider: "model-provider-b" }),
  },
  byAccount: {
    one: item({ accountName: "unique-account", rawModel: "account-model", provider: "account-provider" }),
    twoA: item({ accountName: "shared-account", rawModel: "account-model-a", provider: "account-provider-a" }),
    twoB: item({ accountName: "shared-account", rawModel: "account-model-b", provider: "account-provider-b" }),
  },
  byApiKey: {
    one: item({ keyName: "unique-key", rawModel: "key-model", provider: "key-provider" }),
    twoA: item({ keyName: "shared-key", rawModel: "key-model-a", provider: "key-provider-a" }),
    twoB: item({ keyName: "shared-key", rawModel: "key-model-b", provider: "key-provider-b" }),
  },
  byEndpoint: {
    one: item({ endpoint: "/unique", rawModel: "endpoint-model", provider: "endpoint-provider" }),
    twoA: item({ endpoint: "/shared", rawModel: "endpoint-model-a", provider: "endpoint-provider-a" }),
    twoB: item({ endpoint: "/shared", rawModel: "endpoint-model-b", provider: "endpoint-provider-b" }),
  },
  byProvider: { "provider-only": { requests: 3, promptTokens: 2, completionTokens: 1, cost: 0 } },
  pending: { byModel: {}, byAccount: {} },
  activeRequests: [],
  activeSessions: [],
  recentRequests: [],
};

const response = (data) => ({ ok: true, json: async () => data });
const cells = (container, group) => [...container.querySelector(`[data-group="${group}"]`).cells].map((cell) => cell.textContent);

async function selectTable(container, value) {
  await act(async () => {
    const select = container.querySelector("select");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("UsageStats collapsed group summaries", () => {
  let container;
  let root;

  beforeEach(async () => {
    globalThis.EventSource = class { close() {} };
    globalThis.fetch = vi.fn((url) => Promise.resolve(response(String(url).startsWith("/api/usage/stats") ? stats : {})));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(UsageStats, { period: "7d", hidePeriodSelector: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows model and provider metadata for every single-item summary category", async () => {
    expect(cells(container, "unique-model").slice(0, 2)).toEqual(["unique-model", "model-provider"]);
    await selectTable(container, "account");
    expect(cells(container, "unique-account").slice(0, 3)).toEqual(["unique-account", "account-model", "account-provider"]);
    await selectTable(container, "apiKey");
    expect(cells(container, "unique-key").slice(0, 3)).toEqual(["unique-key", "key-model", "key-provider"]);
    await selectTable(container, "endpoint");
    expect(cells(container, "/unique").slice(0, 3)).toEqual(["/unique", "endpoint-model", "endpoint-provider"]);
  });

  it("keeps aggregate summaries as placeholders in every category", async () => {
    expect(cells(container, "shared-model").slice(0, 2)).toEqual(["shared-model", "—"]);
    await selectTable(container, "account");
    expect(cells(container, "shared-account").slice(0, 3)).toEqual(["shared-account", "—", "—"]);
    await selectTable(container, "apiKey");
    expect(cells(container, "shared-key").slice(0, 3)).toEqual(["shared-key", "—", "—"]);
    await selectTable(container, "endpoint");
    expect(cells(container, "/shared").slice(0, 3)).toEqual(["/shared", "—", "—"]);
  });

  it("leaves provider-only summaries without model or account metadata", async () => {
    await selectTable(container, "provider");
    expect(cells(container, "provider-only")).toEqual(["provider-only", "3"]);
    expect(container.querySelector('[data-table="provider"] [data-badge]')).toBeNull();
  });
});
