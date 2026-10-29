import { failedReadStory } from "../../providers/workflowStoryFixtures.js";
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
    const tavilyLink = (await within(section).findByRole("heading", { name: "Tavily" })).closest("a");
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
          { id: "brave-1", provider: "brave-search", testStatus: "success", isActive: false },
        ] }, status: 200 },
        "GET /api/combos": { body: { combos: [] }, status: 200 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = within(await canvas.findByRole("region", { name: "Web Search" }));
    await expect(await search.findByText("1 Connected")).toBeVisible();
    await expect(search.getByText("1 Error")).toBeVisible();
    await expect(search.getByText("Disabled")).toBeVisible();
  },
};

export const LoadFailureAndRetry = failedReadStory({ routes: routes, url: "/api/providers", pathname: "/dashboard/media-providers/web", params: {}, failure: "http", loadedText: "Tavily" });

export const MalformedResponseAndRetry = failedReadStory({ routes: routes, url: "/api/providers", pathname: "/dashboard/media-providers/web", params: {}, failure: "malformed", loadedText: "Tavily" });

export const NetworkFailureAndRetry = failedReadStory({ routes: routes, url: "/api/providers", pathname: "/dashboard/media-providers/web", params: {}, failure: "network", loadedText: "Tavily" });
