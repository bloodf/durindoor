import React from "react";

globalThis.React ??= React;

import { expect, within } from "storybook/test";

import ConnectionGroupsPanel from "./ConnectionGroupsPanel.jsx";

const connections = [
  { id: "conn-openai-1", name: "OpenAI prod", provider: "openai" },
  { id: "conn-anthropic-1", name: "Anthropic team", provider: "anthropic" },
  { id: "conn-google-1", name: "Google pool", provider: "google" },
];

const meta = {
  title: "Production/Combos/ConnectionGroupsPanel",
  component: ConnectionGroupsPanel,
  parameters: { layout: "padded" },
};

export default meta;

const fixtureRoutes = (groups) => ({
  "GET /api/connection-groups": { body: { groups } },
  "POST /api/connection-groups": async (request) => {
    const body = await request.json();
    return { body: { group: { id: `grp-new-${Date.now()}`, name: body.name, connectionIds: [] } } };
  },
  "PUT /api/connection-groups/:id": { body: { ok: true } },
  "DELETE /api/connection-groups/:id": { body: { ok: true } },
});

export const Empty = {
  args: { connections },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: fixtureRoutes([]),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No connection groups yet")).toBeInTheDocument();
  },
};

export const WithGroups = {
  args: { connections },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: fixtureRoutes([
        { id: "grp-prod", name: "Production", connectionIds: ["conn-openai-1", "conn-anthropic-1"] },
        { id: "grp-research", name: "Research", connectionIds: ["conn-google-1"] },
      ]),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const productionRow = (await canvas.findByText("Production")).closest("tr");
    const researchRow = (await canvas.findByText("Research")).closest("tr");
    await expect(within(productionRow).getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(within(researchRow).getByRole("button", { name: "Delete" })).toBeVisible();
  },
};

export const CreateGroup = {
  args: { connections },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: fixtureRoutes([]),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const createButton = await canvas.findByRole("button", { name: /Create group/ });
    await createButton.click();
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog");
    await expect(within(dialog).getByText("Create connection group")).toBeInTheDocument();
  },
};
