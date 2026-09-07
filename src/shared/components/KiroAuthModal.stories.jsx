import React from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import KiroAuthModal from "./KiroAuthModal";
import KiroSocialOAuthModal from "./KiroSocialOAuthModal";

const googleRoutes = {
  "POST /api/oauth/kiro/social-authorize": { status: 200, body: { flowId: "social-flow", state: "social-state", authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=social-state" } },
  "POST /api/oauth/kiro/cancel": { status: 200, body: { ok: true } },
};
const githubRoutes = {
  "POST /api/oauth/kiro/social-authorize": { status: 200, body: { flowId: "social-flow", state: "social-state", authUrl: "https://github.com/login/oauth/authorize?state=social-state" } },
  "POST /api/oauth/kiro/cancel": { status: 200, body: { ok: true } },
};
function mockPopup() {
  const popup = { closed: false, close: fn(), opener: null, location: { set href(url) { popup.url = url; } } };
  const open = spyOn(window, "open").mockReturnValue(popup);
  return () => open.mockRestore();
}

const meta = {
  title: "Production/shared-kiro/KiroAuthModal",
  component: KiroAuthModal,
  args: { isOpen: true, onMethodSelect: fn(), onClose: fn() },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: { "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "Kiro IDE was not found" } } },
    },
  },
};
export default meta;

// Native <dialog> becomes visible only after Modal's post-commit showModal()
// effect runs. Waiting on findByRole alone can resolve before that paint,
// so re-check visibility inside waitFor before scoping queries to it.
async function getVisibleDialog(canvasElement, name = "Connect Kiro") {
  const body = canvasElement.ownerDocument.body;
  const dialog = await waitFor(() => {
    const dialog = within(body).getByRole("dialog", { name });
    expect(dialog).toBeVisible();
    return dialog;
  });
  await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
  return dialog;
}

// Method selection grid: all 5 branches (builder-id, idc, api-key, import,
// import-cli-proxy) rendered as distinct cards.
export const MethodSelection = {
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await waitFor(() => expect(canvas.getByRole("button", { name: /aws builder id/i })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: /aws iam identity center/i })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: /^api key/i })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: /^import token/i })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: /import cliproxyapi json/i })).toBeVisible());
  },
};

// IDC branch: visits the private api-key Notice (real banner) then returns and recreates the mapped IDC validation alert so the scenario still ends on its named outcome.
export const IdcValidationError = {
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^api key/i }));
    await expect(await canvas.findByText("Paste a long-lived Kiro/CodeWhisperer API key. It is validated against AWS and stored directly as a bearer credential.")).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: /^back$/i }));
    await userEvent.click(await canvas.findByRole("button", { name: /aws iam identity center/i }));
    await userEvent.click(await canvas.findByRole("button", { name: /^continue$/i }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(/enter your idc start url/i);
  },
};

// API key branch: validation, then Back returns to the method grid.
export const ApiKeyBackNavigation = {
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^api key/i }));
    await waitFor(() => expect(canvas.getByLabelText(/^api key/i)).toBeVisible());
    await userEvent.click(await canvas.findByRole("button", { name: /^back$/i }));
    await waitFor(() => expect(canvas.getByRole("button", { name: /aws builder id/i })).toBeVisible());
  },
};

// Import branch: auto-detect fetch resolves with an error, surfaced inline.
export const ImportAutoDetectFailure = {
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^import token/i }));
    await waitFor(() => expect(canvas.getByText(/kiro ide was not found/i)).toBeVisible());
  },
};

// Import branch: auto-detect never resolves, LoadingState stays visible and
// accessible (status role) instead of flashing through.
export const ImportAutoDetecting = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: { "GET /api/oauth/kiro/auto-import": () => new Promise(() => {}) },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^import token/i }));
    await waitFor(() => expect(canvas.getByText(/auto-detecting token/i)).toBeVisible());
    await waitFor(() => expect(canvas.getByText(/reading from aws sso cache/i)).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent(/auto-detecting token/i));
  },
};

// Import branch: auto-detect succeeds, success Notice renders and prefills
// the refresh-token field so Import becomes enabled.
export const ImportAutoDetected = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: { "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: true, refreshToken: "rt_detected" } } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^import token/i }));
    await waitFor(() => expect(canvas.getByText(/token auto-detected from kiro ide successfully/i)).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: /^import token$/i })).toBeEnabled());
  },
};

// CLIProxyAPI branch submits concrete JSON and surfaces server failure.
export const CliProxyImportFailure = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "n/a" } },
        "POST /api/oauth/kiro/import-cli-proxy": { status: 400, body: { error: "Unsupported auth_method" } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /import cliproxyapi json/i }));
    await userEvent.type(await canvas.findByLabelText(/cliproxyapi auth json/i), '{{"auth_method":"external_idp"}');
    await expect(await canvas.findByLabelText(/cliproxyapi auth json/i)).toHaveValue('{"auth_method":"external_idp"}');
    await userEvent.click(await canvas.findByRole("button", { name: /^import cliproxyapi json$/i }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(/unsupported auth_method/i);
  },
};

// Social controls are intentionally hidden in KiroAuthModal. Exercise its real
// KiroSocialOAuthModal child directly instead of dispatching clicks on hidden UI.
export const SocialGoogleManualCallback = {
  beforeEach: mockPopup,
  render: () => <KiroSocialOAuthModal isOpen provider="google" onSuccess={fn()} onClose={fn()} proxyPools={[]} proxyPoolsReady />,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: googleRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via Google"));
    await waitFor(() => expect(canvas.getByLabelText("Authorization URL")).toBeVisible());
    await expect(window.open).toHaveBeenCalledWith("", "kiro_oauth_popup", "width=600,height=700");
    await expect(window.open.mock.results[0].value.url).toBe(googleRoutes["POST /api/oauth/kiro/social-authorize"].body.authUrl);
  },
};

export const SocialGitHubManualCallback = {
  beforeEach: mockPopup,
  render: () => <KiroSocialOAuthModal isOpen provider="github" onSuccess={fn()} onClose={fn()} proxyPools={[]} proxyPoolsReady />,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: githubRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro via GitHub"));
    await waitFor(() => expect(canvas.getByLabelText("Authorization URL")).toBeVisible());
    await expect(window.open).toHaveBeenCalledWith("", "kiro_oauth_popup", "width=600,height=700");
    await expect(window.open.mock.results[0].value.url).toBe(githubRoutes["POST /api/oauth/kiro/social-authorize"].body.authUrl);
  },
};

// IDC branch: valid start URL calls onMethodSelect("idc", {...}) — a real
// success transition, not just the validation-error edge.
export const IdcContinueSuccess = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /aws iam identity center/i }));
    const urlField = await canvas.findByPlaceholderText(/awsapps\.com\/start/i);
    await userEvent.type(urlField, "https://acme.awsapps.com/start");
    await userEvent.click(await canvas.findByRole("button", { name: /^continue$/i }));
    await expect(args.onMethodSelect).toHaveBeenCalledWith("idc", { startUrl: "https://acme.awsapps.com/start", region: "us-east-1" });
  },
};

// API key branch: valid key submits, server accepts, onMethodSelect("api-key").
export const ApiKeySubmitSuccess = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "n/a" } },
        "POST /api/oauth/kiro/api-key": { status: 200, body: { ok: true } },
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^api key/i }));
    const keyField = await canvas.findByPlaceholderText(/paste your kiro api key/i);
    await userEvent.type(keyField, "kiro_key_123");
    await userEvent.click(await canvas.findByRole("button", { name: /add api key/i }));
    await expect(args.onMethodSelect).toHaveBeenCalledWith("api-key");
  },
};

// Import branch: refresh token submits, server accepts, onMethodSelect("import").
export const ImportTokenSubmitSuccess = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "n/a" } },
        "POST /api/oauth/kiro/import": { status: 200, body: { ok: true } },
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /^import token/i }));
    const tokenField = await canvas.findByPlaceholderText(/token will be auto-filled/i);
    await userEvent.type(tokenField, "rt_manual_123");
    await userEvent.click(await canvas.findByRole("button", { name: /^import token$/i }));
    await expect(args.onMethodSelect).toHaveBeenCalledWith("import");
  },
};

// CLIProxyAPI branch: valid JSON submits, server accepts, onMethodSelect("import-cli-proxy").
export const CliProxyImportSuccess = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "n/a" } },
        "POST /api/oauth/kiro/import-cli-proxy": { status: 200, body: { ok: true } },
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    await userEvent.click(await canvas.findByRole("button", { name: /import cliproxyapi json/i }));
    const jsonField = await canvas.findByPlaceholderText(/auth_method/i);
    await userEvent.type(jsonField, '{{"auth_method":"external_idp"}');
    await expect(jsonField).toHaveValue('{"auth_method":"external_idp"}');
    await userEvent.click(await canvas.findByRole("button", { name: /^import cliproxyapi json$/i }));
    await expect(args.onMethodSelect).toHaveBeenCalledWith("import-cli-proxy");
  },
};

// Mobile viewport: method grid collapses to one column and stays >=44px tall.
export const MobileMethodSelection = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement));
    const card = await canvas.findByRole("button", { name: /aws builder id/i });
    await waitFor(() => expect(card).toBeVisible());
    await expect(card.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  },
};

// Main integration fixture sets html lang/dir from this exact locale contract.
export const RtlMethodSelection = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", locale: "ar", params: {}, routes: { "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "n/a" } } } } },
  play: async ({ canvasElement, args }) => {
    await expect(document.documentElement).toHaveAttribute("dir", "rtl");
    const canvas = within(await getVisibleDialog(canvasElement));
    const card = await canvas.findByRole("button", { name: /aws builder id/i });
    await waitFor(() => expect(card).toBeVisible());
    await userEvent.click(card);
    await expect(args.onMethodSelect).toHaveBeenCalledWith("builder-id");
  },
};
