// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, children, footer }) => (open ? h("section", null, children, footer) : null),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, onClick, disabled }) => h("button", { onClick, disabled }, children),
}));
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, value, onChange }) => h("label", null, label, h("input", { value, onChange })),
}));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children, tone }) => h("span", { "data-tone": tone }, children) }));
vi.mock("@/shared/ui/components/Field.jsx", () => ({ default: ({ children }) => h("div", null, children) }));
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: () => null }));

vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/shared/components/WebLoginModal", () => ({ default: () => null }));
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import EditConnectionModal from "@/shared/components/EditConnectionModal.js";
import { POST } from "@/app/api/providers/validate/route.js";
import { probeRegistryProvider } from "@/app/api/providers/providerProbe.js";

// Real registry entries exercise chat-auth, catalog fallback and non-auth-failure probes.
// Only transport is replaced; the registry, validation route and rendered forms are real.
describe.each(["wafer", "qiniu", "gitlawb-gmi"])("%s credential-check outcomes", (provider) => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["add", "edit"].flatMap((form) => [null, 503, 401, 403, 200].map((status) => [form, status])))
  ("%s displays the real validation result for status %s", async (form, status) => {
    const transport = vi.fn(async () => {
      if (status === null) throw new TypeError("offline transport detail");
      return new Response("", { status });
    });
    const probe = await probeRegistryProvider(provider, "fixture-key", transport);
    expect(probe).toMatchObject({ valid: status === 200, status });
    if (status === null || status === 503) expect(probe.unavailable).toBe(true);
    else expect(probe.unavailable).not.toBe(true);

    const payloads = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url !== "/api/providers/validate") return transport(url, options);
      const response = await POST(new Request("http://localhost/api/providers/validate", options));
      payloads.push(await response.clone().json());
      return response;
    }));
    const common = { isOpen: true, proxyPools: [], onSave: vi.fn(), onClose: vi.fn() };
    await act(async () => root.render(form === "add"
      ? h(AddApiKeyModal, { ...common, provider, providerName: provider, authType: "apikey" })
      : h(EditConnectionModal, { ...common, connection: { id: "fixture", provider, name: "fixture", authType: "apikey", priority: 1, providerSpecificData: {} } })));
    const label = Array.from(container.querySelectorAll("label")).find((node) => node.textContent.startsWith("API Key"));
    const input = label.querySelector("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "fixture-key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const check = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Check");
    expect(check).toBeDefined();
    await act(async () => check.click());
    const unavailable = status === null || status === 503;
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ valid: status === 200 });
    expect(payloads[0].unavailable === true).toBe(unavailable);
    if (status === 401 || status === 403) expect(payloads[0].error).toBe("Invalid API key");
    expect(container.textContent).toContain(unavailable ? "Unavailable" : status === 200 ? "Valid" : "Invalid");
    if (unavailable) {
      expect(container.textContent).not.toContain("Invalid");
      expect(container.querySelector('[data-tone="neutral"]').textContent).toBe("Unavailable");
    }
    expect(JSON.stringify(payloads)).not.toContain("fixture-key");
    expect(JSON.stringify(payloads)).not.toContain("offline transport detail");
    expect(common.onSave).not.toHaveBeenCalled();
  });
});
