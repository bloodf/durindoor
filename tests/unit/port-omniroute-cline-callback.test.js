// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const redirectUri = "https://platform.claude.com/oauth/code/callback";
const authUrl = `https://claude.ai/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
const response = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
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

describe("OmniRoute 670656c26153 Cline callbacks", () => {
  it("ignores relayed callbacks and exchanges a pasted URL", async () => {
    window.happyDOM.setURL("http://localhost/providers");
    await act(async () => {
      root.render(React.createElement(OAuthModal, {
        isOpen: true, provider: "cline", providerInfo: { name: "Cline" },
        onClose: vi.fn(), onSuccess: vi.fn(), proxyPoolsReady: true,
      }));
    });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(openMock).toHaveBeenCalledWith(authUrl, "_blank", "noopener,noreferrer");
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
        data: { type: "oauth_callback", data: { code: "attacker", state } } }));
      window.dispatchEvent(new StorageEvent("storage", { key: "oauth_callback",
        newValue: JSON.stringify({ code: "attacker", state, timestamp: Date.now() }) }));
    });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/exchange"))).toBe(false);
    const input = container.querySelector('input[aria-label="Callback URL"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "http://localhost/callback?code=legitimate");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Connect").click();
    });
    const exchange = fetchMock.mock.calls.find(([url]) => url === "/api/oauth/cline/exchange");
    expect(JSON.parse(exchange[1].body)).toEqual({ code: "legitimate", state, flowId: "flow-1" });
  });
});

describe("OmniRoute 12932dce (#20580) Zed Hosted callbacks", () => {
  it("exchanges a pasted native-app URL that carries no state", async () => {
    window.happyDOM.setURL("http://localhost/providers");
    await act(async () => {
      root.render(React.createElement(OAuthModal, {
        isOpen: true, provider: "zed-hosted", providerInfo: { name: "Zed" },
        onClose: vi.fn(), onSuccess: vi.fn(), proxyPoolsReady: true,
      }));
    });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const pasted = "http://127.0.0.1:20128/?user_id=7&access_token=synthetic";
    const input = container.querySelector('input[aria-label="Callback URL"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, pasted);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Connect").click();
    });
    const exchange = fetchMock.mock.calls.find(([url]) => url === "/api/oauth/zed-hosted/exchange");
    expect(JSON.parse(exchange[1].body)).toEqual({ code: pasted, state, flowId: "flow-1" });
  });
});
