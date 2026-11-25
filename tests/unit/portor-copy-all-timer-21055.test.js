// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/ui/components/Card.jsx", () => ({
  Card: ({ children }) => React.createElement("section", null, children),
  CardHeader: ({ title }) => React.createElement("h2", null, title),
  CardContent: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({ default: ({ children, loading: _loading, ...props }) => React.createElement("button", props, children) }));
vi.mock("@/shared/ui/components/Drawer.jsx", () => ({ default: ({ open, children, title }) => open ? React.createElement("aside", null, React.createElement("h2", null, title), children) : null }));
vi.mock("@/shared/ui/components/Pagination.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Input.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/utils/cn", () => ({ cn: (...classes) => classes.filter(Boolean).join(" ") }));
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

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const buttonByText = (container, text) =>
  Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text);

describe("OmniRoute #21055 — Copy all reset timer", () => {
  let container;
  let root;
  let mounted;
  let pending;

  const unmount = () => {
    if (mounted) act(() => root.unmount());
    mounted = false;
  };

  const openDrawer = async () => {
    await act(async () => root.render(React.createElement(RequestDetailsTab)));
    await flush();
    await act(async () => buttonByText(container, "Detail").click());
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).startsWith("/api/usage/request-details")
        ? { details: [detail], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }
        : { providers: [], nodes: [] },
    }));
    // Track only the 2 s reset timers; every other timer stays real.
    pending = new Set();
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, delay, ...args) => {
      const id = realSet(fn, delay, ...args);
      if (delay === 2000) pending.add(id);
      return id;
    });
    vi.spyOn(globalThis, "clearTimeout").mockImplementation((id) => {
      pending.delete(id);
      realClear(id);
    });
  });

  afterEach(() => {
    unmount();
    for (const id of pending) clearTimeout(id);
    container.remove();
    vi.restoreAllMocks();
  });

  const setClipboard = (writeText) =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  it("keeps one timer across repeated copies and cancels it on unmount", async () => {
    setClipboard(() => Promise.resolve());
    await openDrawer();

    await act(async () => buttonByText(container, "Copy all").click());
    await act(async () => buttonByText(container, "Copied").click());
    expect(pending.size).toBe(1);

    unmount();
    expect(pending.size).toBe(0);
  });

  it("starts no timer when the clipboard resolves after unmount", async () => {
    let finishWrite;
    setClipboard(() => new Promise((resolve) => { finishWrite = resolve; }));
    await openDrawer();
    await act(async () => buttonByText(container, "Copy all").click());

    unmount();
    await act(async () => finishWrite());

    expect(pending.size).toBe(0);
  });
});
