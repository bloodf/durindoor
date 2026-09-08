import React from "react";
import { expect, within } from "storybook/test";
import CallbackPage from "./page.js";
import { CallbackStatusView } from "./CallbackStatusView.js";

export default {
  title: "Production/Public/Callback",
  component: CallbackPage,
  parameters: { layout: "fullscreen" },
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

export const Processing = { render: () => <CallbackStatusView status="processing" /> };
export const Success = { render: () => <CallbackStatusView status="success" /> };
export const Done = { render: () => <CallbackStatusView status="done" /> };
export const Error = { render: () => <CallbackStatusView status="error" failureMessage="The provider rejected this login." /> };
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
