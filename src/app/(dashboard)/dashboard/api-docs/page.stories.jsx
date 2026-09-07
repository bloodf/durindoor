import React from "react";
import { expect, within } from "storybook/test";
import ApiDocsPage from "./page.js";

const meta = {
  title: "Durin DS/Production Pages/api-docs",
  component: ApiDocsPage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/api-docs", routes: {} } },
};
export default meta;

export const Default = {
  name: "Default",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pageHeading = await canvas.findByRole("heading", { name: "API Documentation", level: 1 });
    await expect(pageHeading).toBeVisible();
    const chatGroup = await canvas.findByRole("heading", { name: "Chat & Completions", level: 2 });
    await expect(chatGroup).toBeVisible();
    const realtimeGroup = await canvas.findByRole("heading", { name: "Realtime", level: 2 });
    await expect(realtimeGroup).toBeVisible();
    const getBadge = await canvas.findAllByText("GET");
    await expect(getBadge.length).toBeGreaterThan(0);
    const postBadge = await canvas.findAllByText("POST");
    await expect(postBadge.length).toBeGreaterThan(0);
    await expect(canvas.getByText("/v1/realtime/auth")).toBeVisible();
    await expect(canvas.getByText("/api/v1/provider-plugin-manifest")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Example request", level: 2 })).toBeVisible();
  },
};
