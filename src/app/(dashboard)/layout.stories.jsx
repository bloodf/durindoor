import React from "react";
import { expect, within } from "storybook/test";
import DashboardRootLayout from "./layout.js";
import { useNotificationStore } from "@/store/notificationStore";

// This wrapper imports only the owned client shell. RootLayout's privileged
// bootstrap and server document metadata are deliberately not evaluated here.
export default {
  title: "Production/Shell/DashboardRootLayout",
  component: DashboardRootLayout,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      routes: {
        "GET /api/settings": { body: {} },
        "GET /api/version": { body: {} },
        "GET /api/auth/status": { body: {} },
      },
    },
  },
  beforeEach: () => {
    const previous = useNotificationStore.getState().notifications;
    useNotificationStore.getState().clearAll();
    return () => useNotificationStore.setState({ notifications: previous });
  },
};

export const ChildComposition = {
  render: () => <DashboardRootLayout><section aria-label="Route content"><h1 className="text-xl font-semibold text-dd-text">Usage route content</h1></section></DashboardRootLayout>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Usage route content" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Route content" })).toBeVisible();
  },
};
