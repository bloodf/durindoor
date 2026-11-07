// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, usePathname: () => "/dashboard/quota", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/shared/utils/latestIntentQueue", () => ({ createLatestIntentQueue: () => ({ hydrate: () => {}, enqueue: async () => {} }) }));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
// AI_PROVIDERS left empty so connection labels fall back to connection.name and
// the two Codex accounts stay distinguishable in assertions.
vi.mock("@/shared/constants/providers", () => ({ USAGE_SUPPORTED_PROVIDERS: ["codex"], AI_PROVIDERS: {} }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: null, copy: () => {} }) }));
vi.mock("@/shared/utils/codexPlanLabel", () => ({ getCodexPlan: () => null }));
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
vi.mock("@/shared/ui/components/ConfirmDialog.jsx", () => ({ default: () => null }));

import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";

const response = (body) => ({ ok: true, status: 200, json: async () => body });
const notice = "Prepaid credit only. Inference readiness remains unknown.";

describe("credit groups with a saved merged preference", () => {
  let container;
  let root;
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("quotaMergedProviders", JSON.stringify({ xai: true }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it.each([[10, 20], [0, 20], [0, 0]])("keeps %s and %s USD separate through parser, grouped caller and real table", async (first, second) => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const target = String(url);
      if (target.startsWith("/api/settings")) return Promise.resolve(response({ quotaTrackerState: {}, quotaVisibility: {}, claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} } }));
      if (target.startsWith("/api/proxy-pools")) return Promise.resolve(response({ proxyPools: [] }));
      if (target.startsWith("/api/providers/client")) return Promise.resolve(response({ connections: [
        { id: "xai-1", provider: "xai", name: "First account", authType: "apikey", isActive: true },
        { id: "xai-2", provider: "xai", name: "Second account", authType: "apikey", isActive: true },
      ], providerOptions: ["xai"], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 }, totals: { eligibleConnections: 2, providerFilteredConnections: 2 } }));
      const balance = target.startsWith("/api/usage/xai-1") ? first : second;
      if (target.startsWith("/api/usage/xai-")) return Promise.resolve(response({ notice, quotas: { "Prepaid credit (USD)": { total: balance, used: 0, isCreditBalance: true, currency: "USD" } } }));
      return Promise.resolve(response({}));
    }));
    await act(async () => {
      root.render(React.createElement(ProviderLimits));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const sections = Array.from(container.querySelectorAll("section"));
    const firstSection = sections.find((section) => section.textContent.includes("First account"));
    const secondSection = sections.find((section) => section.textContent.includes("Second account"));
    expect(firstSection).toBeDefined();
    expect(secondSection).toBeDefined();
    expect(firstSection.textContent).toContain(`Credit: ${first.toFixed(2)} USD`);
    expect(secondSection.textContent).toContain(`Credit: ${second.toFixed(2)} USD`);
    expect(firstSection.textContent).toContain(notice);
    expect(secondSection.textContent).toContain(notice);
    expect(container.querySelector('[aria-label="Merge xai quotas across accounts"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\d+%/);
  });
});
