// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/components/Card", () => ({ default: ({ children }) => React.createElement("section", null, children) }));
vi.mock("@/shared/components/Button", () => ({ default: ({ children, ...props }) => React.createElement("button", props, children) }));
vi.mock("@/shared/components/Drawer", () => ({ default: ({ isOpen, children, title }) => isOpen ? React.createElement("aside", null, React.createElement("h2", null, title), children) : null }));
vi.mock("@/shared/components/Pagination", () => ({ default: () => null }));
vi.mock("@/shared/constants/providers", () => ({ AI_PROVIDERS: {}, getProviderByAlias: () => null }));

import RequestDetailsTab from "@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js";

const detail = {
  id: "request-1",
  timestamp: "2026-09-01T00:00:00.000Z",
  provider: "openai",
  model: "gpt-test",
  status: "success",
  latency: { ttft: 10, total: 20 },
  tokens: { prompt_tokens: 2, completion_tokens: 3 },
  request: { redacted: true, version: 1, present: true, type: "object", bytes: 111 },
  providerRequest: { redacted: true, version: 1, present: true, type: "object", bytes: 222 },
  providerResponse: { redacted: true, version: 1, present: true, type: "object", bytes: 333 },
  response: { redacted: true, version: 1, present: true, type: "object", bytes: 444 },
};

function mockSettingsResponse(enableObservability) {
  return (url) => {
    if (String(url) === "/api/settings") {
      return Promise.resolve({ ok: true, json: async () => ({ enableObservability }) });
    }
    if (String(url).startsWith("/api/usage/request-details")) {
      return Promise.resolve({ ok: true, json: async () => ({ details: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }) });
    }
    if (String(url) === "/api/usage/providers") {
      return Promise.resolve({ ok: true, json: async () => ({ providers: [{ id: "openai", name: "OpenAI" }] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ nodes: [] }) });
  };
}

describe("Request Details metadata-only UI", () => {
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
    vi.restoreAllMocks();
  });

  it("explains all four redacted stages and offers no raw payload copy or view path", async () => {
    globalThis.fetch = vi.fn(async (url) => ({
      json: async () => String(url).startsWith("/api/usage/request-details")
        ? { details: [detail], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }
        : String(url) === "/api/usage/providers"
          ? { providers: [{ id: "openai", name: "OpenAI" }] }
          : { nodes: [] },
    }));

    await act(async () => {
      root.render(React.createElement(RequestDetailsTab));
      await Promise.resolve();
      await Promise.resolve();
    });
    const detailButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Detail");
    await act(async () => detailButton.click());

    expect(container.textContent).toContain("Payloads intentionally redacted");
    for (const label of ["Client request", "Provider request", "Provider response", "Client response"]) {
      expect(container.textContent).toContain(label);
    }
    for (const bytes of ["111 bytes", "222 bytes", "333 bytes", "444 bytes"]) {
      expect(container.textContent).toContain(bytes);
    }
    expect(container.textContent).not.toMatch(/Copy|Provider Response \(Raw\)|Client Request \(Input\)|No data available/);
  });

  it("renders the observability callout with a settings link when observability is disabled", async () => {
    globalThis.fetch = vi.fn(mockSettingsResponse(false));

    await act(async () => {
      root.render(React.createElement(RequestDetailsTab));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const callout = container.querySelector("[data-observability-callout=\"off\"]");
    expect(callout).not.toBeNull();
    expect(callout.textContent).toContain("Request details logging is turned off");
    const link = callout.querySelector("a[href=\"/dashboard/profile\"]");
    expect(link).not.toBeNull();
    expect(link.textContent.trim()).toBe("Open Settings");
  });

  it("renders the ordinary empty state when observability is enabled", async () => {
    globalThis.fetch = vi.fn(mockSettingsResponse(true));

    await act(async () => {
      root.render(React.createElement(RequestDetailsTab));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-observability-callout=\"off\"]")).toBeNull();
    expect(container.textContent).toContain("No request details found");
  });
});
