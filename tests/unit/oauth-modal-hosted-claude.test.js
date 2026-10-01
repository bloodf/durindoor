// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/shared/ui/components/Modal", () => ({
  default: ({ open, children }) => open ? React.createElement("section", null, children) : null,
}));
vi.mock("@/shared/ui/components/Button", () => ({
  default: ({ children, ...props }) => React.createElement("button", props, children),
}));
vi.mock("@/shared/ui/components/Input", () => ({
  default: (props) => React.createElement("input", props),
}));
vi.mock("@/shared/ui/components/Select", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/IconButton", () => ({ default: () => null }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }),
}));

import OAuthModal from "@/shared/components/OAuthModal.js";

const state = "generated-state";
const redirectUri = "https://console.anthropic.com/oauth/code/callback";
const authUrl = `https://claude.ai/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
const response = (data) => ({ ok: true, status: 200, json: async () => data });
let container;
let root;
let fetchMock;
let openMock;

beforeEach(() => {
  vi.useFakeTimers();
  window.happyDOM.setURL("https://dashboard.example/providers");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(async (url) => url.endsWith("/authorize")
    ? response({ authUrl, flowId: "flow-1", state })
    : response({ success: true }));
  globalThis.fetch = fetchMock;
  openMock = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  vi.restoreAllMocks();
});

it("opens registered Claude redirect and binds pasted code to the active flow", async () => {
  await act(async () => {
    root.render(React.createElement(OAuthModal, {
      isOpen: true,
      provider: "claude",
      providerInfo: { name: "Claude" },
      onClose: vi.fn(),
      onSuccess: vi.fn(),
      proxyPoolsReady: true,
    }));
  });
  await act(async () => { await vi.runOnlyPendingTimersAsync(); });

  const authorize = fetchMock.mock.calls.find(([url]) => url === "/api/oauth/claude/authorize");
  expect(JSON.parse(authorize[1].body).redirectUri).toBe(redirectUri);
  expect(new URL(openMock.mock.calls[0][0]).searchParams.get("redirect_uri")).toBe(redirectUri);
  expect(container.textContent).toContain("copy the code shown by Anthropic");

  const input = container.querySelector('input[aria-label="Callback URL"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "copied-code");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Connect").click();
  });
  const exchange = fetchMock.mock.calls.find(([url]) => url === "/api/oauth/claude/exchange");
  expect(JSON.parse(exchange[1].body)).toEqual({ code: "copied-code", state, flowId: "flow-1" });
});
