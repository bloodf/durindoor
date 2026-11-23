import React from "react";
import { expect, fn, spyOn, waitFor, within } from "storybook/test";
import KiroSocialOAuthModal from "./KiroSocialOAuthModal";

function mockPopup() {
  const popup = { closed: false, close: fn(), opener: null, location: { set href(url) { popup.url = url; } } };
  const open = spyOn(window, "open").mockReturnValue(popup);
  return () => open.mockRestore();
}

const authorize = {
  status: 200,
  body: { flowId: "flow-1", state: "state-1", authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=state-1", userCode: "ABCD", interval: 1, expiresAt: Date.now() + 300000 },
};
const cancel = { status: 200, body: { ok: true } };
const baseRoutes = { "POST /api/oauth/kiro/social-authorize": authorize, "POST /api/oauth/kiro/cancel": cancel };

const meta = {
  title: "Production/shared-kiro/KiroSocialOAuthModal",
  component: KiroSocialOAuthModal,
  args: { isOpen: true, provider: "google", onSuccess: fn(), onClose: fn(), proxyPools: [], proxyPoolsReady: true },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: baseRoutes } },
};
export default meta;

// Native <dialog> becomes visible only after Modal's post-commit showModal()
// effect runs. Waiting on findByRole alone can resolve before that paint,
// so re-check visibility inside waitFor before scoping queries to it.
async function getVisibleDialog(canvasElement, name = "Connect Kiro via Google") {
  const body = canvasElement.ownerDocument.body;
  const dialog = await waitFor(() => {
    const dialog = within(body).getByRole("dialog", { name });
    expect(dialog).toBeVisible();
    return dialog;
  });
  await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
  return dialog;
}

export const Initializing = {
  beforeEach: mockPopup,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "POST /api/oauth/kiro/social-authorize": () => new Promise(() => {}), "POST /api/oauth/kiro/cancel": cancel } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent(/initializing/i));
    await waitFor(() => expect(canvas.getByText(/setting up google authentication/i)).toBeVisible());
  },
};

export const RoutingOptionsLoading = {
  args: { proxyPoolsReady: false },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent(/loading routing options/i));
  },
};

export const GoogleInput = {
  beforeEach: mockPopup,
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByText(/using code ABCD/i)).toBeVisible());
  },
};

export const GoogleWithProxyPool = {
  beforeEach: mockPopup,
  args: { proxyPools: [{ id: "pool-1", name: "US East", isActive: true }] },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByText(/routing proxy pool/i)).toBeVisible());
  },
};

export const GitHubInput = {
  beforeEach: mockPopup,
  args: { provider: "github" },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via GitHub"));
    await waitFor(() => expect(canvas.getByText(/connect kiro via github/i)).toBeVisible());
  },
};

export const ManualCallbackSuccess = {
  beforeEach: mockPopup,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { ...baseRoutes, "POST /api/oauth/kiro/social-exchange": { status: 200, body: { success: true } } } } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByText(/connected successfully/i)).toBeVisible(), { timeout: 4000 });
    await expect(args.onSuccess).toHaveBeenCalled();
  },
};

export const ManualCallbackFailure = {
  beforeEach: mockPopup,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { ...baseRoutes, "POST /api/oauth/kiro/social-exchange": { status: 400, body: { error: "Invalid authorization code" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent(/invalid authorization code/i), { timeout: 4000 });
    await waitFor(() => expect(canvas.getByRole("button", { name: /try again/i })).toBeVisible());
  },
};

export const Exchanging = {
  beforeEach: mockPopup,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { ...baseRoutes, "POST /api/oauth/kiro/social-exchange": () => new Promise(() => {}) } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByText(/waiting for authorization/i)).toBeVisible());
  },
};
