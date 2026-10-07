import React from "react";
import { expect, spyOn, waitFor, within } from "storybook/test";
import CallbackPage from "./page.js";
import { CallbackStatusView } from "./CallbackStatusView.js";

export default {
  title: "Production/Public/Callback",
  component: CallbackPage,
  parameters: { layout: "fullscreen" },
  // Exercise the real delivery effect without closing the preview or broadcasting
  // fixture credentials to other tabs. Restore every boundary on story navigation.
  beforeEach: () => {
    const close = spyOn(window, "close").mockImplementation(() => {});
    const broadcast = spyOn(BroadcastChannel.prototype, "postMessage").mockImplementation(() => {});
    const previous = localStorage.getItem("oauth_callback");
    return () => {
      close.mockRestore();
      broadcast.mockRestore();
      if (previous === null) localStorage.removeItem("oauth_callback");
      else localStorage.setItem("oauth_callback", previous);
    };
  },
};

export const LiveSuccess = {
  render: () => <CallbackPage />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/callback?code=fixture-code&state=fixture-state",
      params: {},
      routes: {},
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("heading", { name: "Authorization successful!" })).toBeVisible();
    await waitFor(() => expect(within(canvasElement).getByText("You can close this tab now.")).toBeVisible(), { timeout: 4000 });
  },
};

export const LiveError = {
  render: () => <CallbackPage />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/callback?error=access_denied&error_description=Fixture%20denied",
      params: {},
      routes: {},
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("heading", { name: "Authorization failed" })).toBeVisible();
  },
};

export const LiveManual = {
  render: () => <CallbackPage />,
  parameters: {
    storyFixture: { scenario: "default", pathname: "/callback", params: {}, routes: {} },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("heading", { name: "Copy this URL" })).toBeVisible();
  },
};

export const Processing = {
  render: () => <CallbackStatusView status="processing" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Processing…" })).toBeVisible();
  },
};
export const Success = {
  render: () => <CallbackStatusView status="success" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("This window will close automatically…")).toBeVisible();
  },
};
export const Done = {
  render: () => <CallbackStatusView status="done" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("You can close this tab now.")).toBeVisible();
  },
};
export const Error = {
  render: () => <CallbackStatusView status="error" failureMessage="The provider rejected this login." />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("The provider rejected this login.")).toBeVisible();
  },
};
export const ManualFallback = {
  render: () => <CallbackPage />,
  parameters: {
    storyFixture: { scenario: "default", pathname: "/callback", params: {}, routes: {} },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Copy this URL" })).toBeVisible();
    await expect(canvas.getByText("Please copy the URL from the address bar and paste it in the application.")).toBeVisible();
  },
};
