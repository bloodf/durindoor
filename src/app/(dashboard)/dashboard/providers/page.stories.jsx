import React from "react";
import { expect, userEvent, within } from "storybook/test";

import ProvidersPage from "./page";

const connection = {
  id: "openai-main",
  provider: "openai",
  authType: "apikey",
  name: "Production",
  isActive: true,
  testStatus: "active",
  priority: 1,
};

const baseRoutes = {
  "GET /api/providers": { body: { connections: [connection] } },
  "GET /api/provider-nodes": { body: { nodes: [] } },
  "GET /api/settings": { body: { disabledFreeProviders: [] } },
};

const meta = {
  title: "Production/providers/ProvidersPage",
  component: ProvidersPage,
  parameters: {
    layout: "fullscreen",
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: baseRoutes },
  },
};

export default meta;

/** Parent scenario covers ProviderCard, ApiKeyProviderCard, ProviderTestResultsView through real provider inventory and the live status listbox. */
export const Inventory = {};

/** Status filter uses the DS listbox, drives real getProviderStatus filtering on the page. */
export const StatusFiltering = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = await canvas.findByLabelText("Provider status");
    await userEvent.click(status);
    await userEvent.click(await within(document.body).findByRole("option", { name: "Not configured" }));
    await expect(status).toHaveTextContent("Not configured");
  },
};

/** Multi-status scenario: connected OAuth, deactivated API key, and a disabled free no-auth provider. Exercises ProviderTestResultsView through the API Key batch-test action. */
export const AllStatusScenarios = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "GET /api/providers": {
          body: {
            connections: [
              connection,
              {
                id: "anthropic-main",
                provider: "anthropic",
                authType: "apikey",
                name: "Backup",
                isActive: false,
                testStatus: "error",
                priority: 2,
                lastError: "Invalid API key",
                lastErrorAt: new Date(Date.now() - 60000).toISOString(),
              },
            ],
          },
        },
        "GET /api/provider-nodes": { body: { nodes: [] } },
        "GET /api/settings": { body: { disabledFreeProviders: ["kiro"] } },
        "POST /api/providers/test-batch": {
          body: {
            summary: { passed: 1, failed: 1, total: 2 },
            mode: "apikey",
            results: [
              { connectionId: "openai-main", connectionName: "Production", provider: "openai", valid: true, latencyMs: 42 },
              { connectionId: "anthropic-main", connectionName: "Backup", provider: "anthropic", valid: false, diagnosis: { type: "AUTH" } },
            ],
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Test all API Key connections" }));
    await expect(await canvas.findByRole("heading", { name: "Test Results" })).toBeVisible();
    await expect(canvas.getByText("API Key Test")).toBeVisible();
    await expect(canvas.getByText("1 passed")).toBeVisible();
    await expect(canvas.getByText("1 failed")).toBeVisible();
    await expect(canvas.getByText("42ms")).toBeVisible();
    await expect(canvas.getByText("AUTH")).toBeVisible();
  },
};
