import React from "react";
import { expect, userEvent, within } from "storybook/test";
import WebProvidersPage from "./page.js";

const routes = {
  "GET /api/providers": { body: { connections: [] }, status: 200 },
  "GET /api/combos": { body: { combos: [] }, status: 200 },
};

export default {
  title: "Production/media/WebListing",
  component: WebProvidersPage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/web",
      params: {},
      routes,
    },
  },
};

export const Default = {};

export const CreateComboError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/web",
      params: {},
      routes: { ...routes, "GET /api/combos": { body: { combos: [{ id: "search-combo-1", name: "research-pool", kind: "webSearch", models: ["tavily/search", "exa/search"] }] }, status: 200 }, "POST /api/combos": { body: { error: "Server rejected combo" }, status: 422 } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByRole("region", { name: "Web Search" });
    await expect(within(section).getByText("Tavily")).toBeVisible();
    const tavilyLink = within(section).getByRole("link", { name: /Tavily/i });
    await expect(within(tavilyLink).getByText("No connections")).toBeVisible();
    const combo = await within(section).findByRole("link", { name: /research-pool/i });
    await expect(combo).toHaveAttribute("href", "/dashboard/media-providers/combo/search-combo-1");
    await expect(within(combo).getByText("2")).toBeVisible();
    const button = within(section).getByRole("button", { name: "Create Combo" });
    await userEvent.click(button);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(/Server rejected combo/);
  },
};

export const ConnectionStatuses = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/web",
      params: {},
      routes: {
        "GET /api/providers": { body: { connections: [
          { id: "tavily-1", provider: "tavily", testStatus: "success", isActive: true },
          { id: "exa-1", provider: "exa", testStatus: "error", isActive: true },
          { id: "jina-1", provider: "jina", testStatus: "success", isActive: false },
        ] }, status: 200 },
        "GET /api/combos": { body: { combos: [] }, status: 200 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("1 Connected")).toBeVisible();
    await expect(canvas.getByText("1 Error")).toBeVisible();
    await expect(canvas.getByText("Disabled")).toBeVisible();
  },
};
