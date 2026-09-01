// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/components", () => ({
  Button: ({ children, onClick, disabled }) => React.createElement("button", { onClick, disabled }, children),
  Input: (props) => React.createElement("input", props),
  Modal: ({ isOpen, title, children }) => isOpen ? React.createElement(
    "section",
    null,
    React.createElement("h2", null, title),
    children,
  ) : null,
  Select: ({ label, value, onChange, options }) => React.createElement(
    "label",
    null,
    label,
    React.createElement(
      "select",
      { value, onChange },
      options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label)),
    ),
  ),
}));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }),
}));

import OAuthModal from "@/shared/components/OAuthModal.js";

const state = "generated-state";
const redirectUri = "http://localhost:1455/auth/callback";
const authUrl = `https://auth.openai.com/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

function response(data) {
  return { ok: true, status: 200, json: async () => data };
}

function renderModal(root) {
  root.render(React.createElement(OAuthModal, {
    isOpen: true,
    provider: "codex",
    providerInfo: { name: "Codex" },
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    proxyPoolsReady: true,
  }));
}

describe("OAuthModal hosted Codex flow", () => {
  let container;
  let root;
  let fetchMock;
  let openMock;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (url) => {
      if (url === "/api/oauth/codex/authorize") {
        return response({ authUrl, flowId: "flow-1", state });
      }
      if (url === "/api/oauth/codex/start-proxy") {
        return response({ success: true, serverSide: true });
      }
      if (url === "/api/oauth/codex/poll-status") {
        return response({ status: "pending" });
      }
      return response({ success: true });
    });
    globalThis.fetch = fetchMock;
    openMock = vi.spyOn(window, "open").mockReturnValue({ closed: false, close: vi.fn() });
  });

  afterEach(async () => {
    act(() => root.unmount());
    await Promise.resolve();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses manual callback immediately on a hosted dashboard", async () => {
    window.happyDOM.setURL("https://dashboard.example/providers");

    await act(async () => {
      renderModal(root);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/oauth/codex/authorize", expect.objectContaining({
      body: expect.any(String),
    }));
    const authorizeRequest = fetchMock.mock.calls.find(([url]) => url === "/api/oauth/codex/authorize")[1];
    expect(JSON.parse(authorizeRequest.body)).toEqual(expect.objectContaining({ redirectUri }));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/oauth/codex/start-proxy")).toBe(false);
    expect(openMock).toHaveBeenCalledWith(authUrl, "_blank", "noopener,noreferrer");
    expect(new URL(openMock.mock.calls[0][0]).searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(new URL(openMock.mock.calls[0][0]).searchParams.get("state")).toBe(state);
    expect(container.textContent).toContain("Paste callback URL manually");
    expect(container.textContent).not.toContain("Waiting for popup authorization");
    expect(Array.from(container.querySelectorAll("input")))
      .toContainEqual(expect.objectContaining({ readOnly: true, value: authUrl }));
  });

  it("keeps proxy, popup, and polling on a loopback dashboard", async () => {
    window.happyDOM.setURL("http://localhost:20127/providers");

    await act(async () => {
      renderModal(root);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock.mock.calls.some(([url]) => url === "/api/oauth/codex/start-proxy")).toBe(true);
    expect(openMock).toHaveBeenCalledWith(authUrl, "oauth_popup", "width=600,height=700");
    expect(container.textContent).toContain("Waiting for popup authorization");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/oauth/codex/poll-status")).toBe(true);
  });

  it("rejects a pasted callback with mismatched state before exchange", async () => {
    window.happyDOM.setURL("https://dashboard.example/providers");

    await act(async () => {
      renderModal(root);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    const input = container.querySelector('input[placeholder="/callback?code=..."]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "http://localhost:1455/auth/callback?code=oauth-code&state=wrong-state");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const connect = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Connect");
    await act(async () => {
      connect.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("OAuth callback state did not match this login attempt");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/oauth/codex/exchange")).toBe(false);
  });
});
