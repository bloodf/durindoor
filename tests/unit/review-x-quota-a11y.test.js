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

describe("quota threshold accessible names", () => {
  it("names each input and save button for its provider and window", async () => {
    window.localStorage.clear();
    globalThis.fetch = vi.fn((url) => {
      if (String(url).startsWith("/api/providers/client")) return Promise.resolve(response({ connections: [{ id: "fixture", provider: "codex", name: "Account", authType: "oauth", isActive: true, quotaWindows: [{ key: "weekly", percent: 10, effectivePercent: 10 }, { key: "daily", percent: null, effectivePercent: null }] }], providerOptions: ["codex"], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, totals: { eligibleConnections: 1, providerFilteredConnections: 1 } }));
      return Promise.resolve(response({}));
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(React.createElement(ProviderLimits)); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      const forms = container.querySelectorAll('form');
      expect(forms).toHaveLength(2);
      for (const [index, windowName] of ["weekly", "daily"].entries()) {
        for (const control of forms[index].querySelectorAll('input, button')) {
          const label = control.getAttribute("aria-label") || Array.from(control.labels || []).map((item) => item.textContent).join(" ");
          expect(label).toContain("codex");
          expect(label).toContain(windowName);
          expect(label).not.toContain(":r");
        }
      }
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
