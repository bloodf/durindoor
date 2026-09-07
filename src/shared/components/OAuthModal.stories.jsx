import React, { useState } from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import OAuthModal from "./OAuthModal";

const AUTHORIZE = {
  authUrl: "https://auth.example.test/authorize?state=story-state",
  flowId: "story-flow",
  state: "story-state",
};

function mockPopup() {
  const popup = { closed: false, close: fn() };
  const open = spyOn(window, "open").mockReturnValue(popup);
  return () => open.mockRestore();
}

const DEVICE_CODE = {
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  verification_uri_complete: "https://github.com/login/device?code=ABCD-1234",
  interval: 5,
  expires_in: 600,
  flowId: "device-flow",
};

function OAuthStory(props) {
  const [open, setOpen] = useState(true);
  return <OAuthModal {...props} isOpen={open} onClose={() => setOpen(false)} />;
}

const meta = {
  title: "Production/shared-oauth/OAuthModal",
  component: OAuthModal,
  parameters: {
    layout: "centered",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/anthropic/authorize": { body: AUTHORIZE, status: 200 },
        "POST /api/oauth/anthropic/exchange": { body: { ok: true }, status: 200 },
        "POST /api/oauth/anthropic/cancel": { body: { ok: true }, status: 200 },
      },
    },
  },
};

export default meta;

export const LoadingRoutingOptions = {
  render: () => (
    <OAuthStory provider="anthropic" providerInfo={{ name: "Anthropic" }} proxyPoolsReady={false} />
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect Anthropic" });
    expect(within(dialog).getByText("Loading routing options…")).toBeInTheDocument();
  },
};

export const ManualCallback = {
  beforeEach: mockPopup,
  render: () => (
    <OAuthStory provider="anthropic" providerInfo={{ name: "Anthropic" }} proxyPoolsReady />
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect Anthropic" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
    await waitFor(() => expect(within(dialog).getByText("Waiting for popup authorization…")).toBeVisible());
    await waitFor(() => expect(within(dialog).getByLabelText("Authorization URL")).toHaveValue(AUTHORIZE.authUrl));
    const callback = within(dialog).getByLabelText("Callback URL");
    await userEvent.type(
      callback,
      "http://localhost/callback?code=story-code&state=story-state",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await expect(window.open).toHaveBeenCalledWith(AUTHORIZE.authUrl, "oauth_popup", "width=600,height=700");
    await expect(await within(dialog).findByText("Connected successfully!")).toBeInTheDocument();
  },
};

export const ProxyAndFingerprint = {
  beforeEach: mockPopup,
  render: () => (
    <OAuthStory
      provider="codex"
      providerInfo={{ name: "Codex" }}
      proxyPoolsReady
      proxyPools={[{ id: "pool-1", name: "EU strict route", isActive: true }]}
    />
  ),
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/codex/authorize": { body: AUTHORIZE, status: 200 },
        "POST /api/oauth/codex/start-proxy": { body: { success: true, serverSide: true }, status: 200 },
        "POST /api/oauth/codex/poll-status": { body: { status: "pending" }, status: 200 },
        "POST /api/oauth/codex/stop-proxy": { body: { ok: true }, status: 200 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect Codex" });
    expect(within(dialog).getByLabelText("Routing proxy pool")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("OAuth fingerprint mode")).toBeInTheDocument();
  },
};

export const DeviceCodeFlow = {
  beforeEach: mockPopup,
  render: () => (
    <OAuthStory provider="github" providerInfo={{ name: "GitHub" }} proxyPoolsReady />
  ),
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/github/device-code": { body: DEVICE_CODE, status: 200 },
        "POST /api/oauth/github/poll": { body: { success: true }, status: 200 },
        "POST /api/oauth/github/cancel": { body: { ok: true }, status: 200 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitHub" });
    expect(await within(dialog).findByText("ABCD-1234")).toBeInTheDocument();
    expect(await within(dialog).findByText(DEVICE_CODE.verification_uri_complete)).toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: "Copy login URL" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: "Copy device code" })).toBeInTheDocument();
  },
};

export const XaiCopiesAuthUrl = {
  beforeEach: mockPopup,
  render: () => (
    <OAuthStory provider="xai" providerInfo={{ name: "xAI" }} proxyPoolsReady />
  ),
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/xai/authorize": { body: AUTHORIZE, status: 200 },
        "POST /api/oauth/xai/start-proxy": { body: { success: true, serverSide: true }, status: 200 },
        "POST /api/oauth/xai/poll-status": { body: { status: "pending" }, status: 200 },
        "POST /api/oauth/xai/stop-proxy": { body: { ok: true }, status: 200 },
        "POST /api/oauth/xai/exchange": { body: { ok: true }, status: 200 },
        "POST /api/oauth/xai/cancel": { body: { ok: true }, status: 200 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect Grok Build OAuth" });
    expect(within(dialog).getByText("Waiting for Grok Build OAuth…")).toBeInTheDocument();
    expect(within(dialog).getByText(/callback URL or copied code/i)).toBeInTheDocument();
  },
};

export const AuthorizationFailure = {
  render: () => (
    <OAuthStory provider="anthropic" providerInfo={{ name: "Anthropic" }} proxyPoolsReady />
  ),
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/anthropic/authorize": {
          body: { error: "OAuth provider is unavailable" },
          status: 503,
        },
        "POST /api/oauth/anthropic/cancel": { body: { ok: true }, status: 200 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect Anthropic" });
    await expect(
      await within(dialog).findByText("OAuth provider is unavailable"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  },
};
