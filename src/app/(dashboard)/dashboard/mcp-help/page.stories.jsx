import React from "react";
import { expect, within } from "storybook/test";
import McpHelpPage from "./page.js";

const meta = {
  title: "Durin DS/Production Pages/mcp-help",
  component: McpHelpPage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/mcp-help", routes: {} } },
};
export default meta;

export const Default = {
  name: "Default",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "MCP Help", level: 1 })).toBeVisible();
    const sectionHeadings = ["Overview", "Transports", "Authentication", "Keys & tool grants", "Client configuration", "Control server", "Connecting upstream servers over OAuth", "Troubleshooting"];
    for (const name of sectionHeadings) {
      await expect(canvas.getByRole("heading", { name, level: 2 })).toBeVisible();
    }
    await expect(canvas.getByText("Authorization: Bearer <gateway-key>")).toBeVisible();
    await expect(canvas.getByText("list_providers")).toBeVisible();
    await expect(canvas.getByText("model_list")).toBeVisible();
  },
};
