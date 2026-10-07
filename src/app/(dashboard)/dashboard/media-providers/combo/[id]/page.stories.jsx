import React from "react";
import { expect, userEvent, within } from "storybook/test";
import ComboDetailPage from "./page.js";

const combo = { id: "combo-1", name: "search-combo", kind: "webSearch", models: ["openai/gpt-4o", "anthropic/claude-3.5"] };
const routes = {
  "GET /api/combos/combo-1": { body: combo, status: 200 },
  "GET /api/settings": { body: { comboStrategies: {} }, status: 200 },
  "GET /api/usage/logs": { body: [], status: 200 },
  "GET /api/providers": { body: { connections: [] }, status: 200 },
  "GET /api/models/alias": { body: { aliases: {} }, status: 200 },
};

export default {
  title: "Production/media/ComboDetail",
  component: ComboDetailPage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/combo/combo-1",
      params: { id: "combo-1" },
      routes,
    },
  },
};

export const Default = {};

export const DeleteOpensConfirm = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", { name: /Delete/ });
    await userEvent.click(button);
    const body = within(document.body);
    const dialog = await body.findByRole("dialog");
    await expect(within(dialog).getByText(/search-combo/)).toBeInTheDocument();
  },
};

export const DeleteError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/combo/combo-1",
      params: { id: "combo-1" },
      routes: { ...routes, "DELETE /api/combos/combo-1": { body: { error: "Forbidden" }, status: 403 } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", { name: /Delete/ });
    await userEvent.click(button);
    const body = within(document.body);
    const dialog = await body.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /^Delete$/ });
    await userEvent.click(confirm);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(/Forbidden/);
  },
};

export const ManageProvidersAndRunExample = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/combo/combo-1",
      params: { id: "combo-1" },
      routes: {
        ...routes,
        "PUT /api/combos/combo-1": { body: combo, status: 200 },
        "PATCH /api/settings": { body: {}, status: 200 },
        "POST /api/v1/search": { body: { results: [{ title: "Story result", url: "https://example.test/result" }] }, status: 200 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const roundRobin = await canvas.findByRole("switch", { name: "Round Robin" });
    await userEvent.click(roundRobin);
    await expect(roundRobin).toHaveAttribute("aria-checked", "true");
    const providers = canvas.getByRole("heading", { name: "Providers" }).parentElement.parentElement.parentElement;
    const firstProviderRow = within(providers).getByText("gpt-4o", { selector: "code" }).parentElement.parentElement;
    await userEvent.click(within(firstProviderRow).getByRole("button", { name: "Move down" }));
    await expect(Array.from(providers.querySelectorAll("code"), (element) => element.textContent)).toEqual(["claude-3.5", "gpt-4o"]);
    await userEvent.click(canvas.getByRole("button", { name: "Run" }));
    await expect(await canvas.findByRole("region", { name: "API response output" })).toHaveTextContent("Story result");
  },
};

export const EmptyProviders = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/combo/combo-1",
      params: { id: "combo-1" },
      routes: { ...routes, "GET /api/combos/combo-1": { body: { ...combo, models: [] }, status: 200 } },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No providers yet")).toBeVisible();
  },
};
