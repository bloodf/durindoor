import React from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import KiroOAuthWrapper from "./KiroOAuthWrapper";

function mockPopup() {
  const popup = { closed: false, close: fn(), opener: null, location: { set href(url) { popup.url = url; } } };
  const open = spyOn(window, "open").mockReturnValue(popup);
  return () => open.mockRestore();
}

const meta = {
  title: "Production/shared-kiro/KiroOAuthWrapper",
  component: KiroOAuthWrapper,
  args: {
    isOpen: true,
    providerInfo: { name: "Kiro" },
    onSuccess: fn(),
    onClose: fn(),
    proxyPools: [],
    proxyPoolsReady: true,
  },
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: {} },
  },
};
export default meta;

async function getVisibleDialog(canvasElement, name) {
  const body = canvasElement.ownerDocument.body;
  const dialog = await waitFor(() => {
    const dialog = within(body).getByRole("dialog", { name });
    expect(dialog).toBeVisible();
    return dialog;
  });
  await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
  return dialog;
}

export const MethodSelection = {
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro"));
    await waitFor(() => expect(canvas.getByRole("button", { name: /aws builder id/i })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: /aws iam identity center/i })).toBeVisible());
  },
};

export const BuilderIdHandoff = {
  beforeEach: mockPopup,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/kiro/device-code": {
          status: 200,
          body: {
            flowId: "builder-flow",
            state: "builder-state",
            verification_uri: "https://example.awsapps.com/activate",
            verification_uri_complete: "https://example.awsapps.com/activate?code=ABCD-EFGH",
            user_code: "ABCD-EFGH",
            interval: 5,
            expires_in: 600,
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro"));
    await userEvent.click(await canvas.findByRole("button", { name: /aws builder id/i }));
    const handoff = within(await getVisibleDialog(canvasElement, "Connect Kiro"));
    await waitFor(() => expect(handoff.getByText("ABCD-EFGH", { selector: "p" })).toBeVisible());
  },
};

export const IdcHandoff = {
  beforeEach: mockPopup,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/kiro/device-code": {
          status: 200,
          body: {
            flowId: "idc-flow",
            state: "idc-state",
            verification_uri: "https://idc.example/activate",
            verification_uri_complete: "https://idc.example/activate?code=IDCCODE",
            user_code: "IDCCODE",
            interval: 5,
            expires_in: 600,
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro"));
    await userEvent.click(await canvas.findByRole("button", { name: /aws iam identity center/i }));
    await userEvent.type(await canvas.findByPlaceholderText(/awsapps\.com\/start/i), "https://acme.awsapps.com/start");
    await userEvent.click(await canvas.findByRole("button", { name: /^continue$/i }));
    const handoff = within(await getVisibleDialog(canvasElement, "Connect Kiro"));
    await waitFor(() => expect(handoff.getByText("IDCCODE", { selector: "p" })).toBeVisible());
  },
};

export const ImportSuccessShortCircuits = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "GET /api/oauth/kiro/auto-import": { status: 200, body: { found: false, error: "Kiro IDE not found" } },
        "POST /api/oauth/kiro/import": { status: 200, body: { ok: true } },
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Kiro"));
    await userEvent.click(await canvas.findByRole("button", { name: /^import token/i }));
    await userEvent.type(await canvas.findByPlaceholderText(/token will be auto-filled/i), "rt_short_circuit");
    await userEvent.click(await canvas.findByRole("button", { name: /^import token$/i }));
    await expect(args.onSuccess).toHaveBeenCalled();
  },
};
