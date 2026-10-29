import { failedReadStory } from "./workflowStoryFixtures.js";
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

/** Status listbox exposes All, then keeps each specific status selectable through real page filtering. */
export const StatusFiltering = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = await canvas.findByLabelText("Provider status");
    await userEvent.click(status);
    await userEvent.click(await within(document.body).findByRole("option", { name: "All", exact: true }));
    await expect(status).toHaveTextContent("All");
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
                isActive: true,
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
    await expect(canvas.getByText("1 Error (AUTH)")).toBeVisible();
  },
};

export const LoadFailureAndRetry = failedReadStory({ routes: baseRoutes, url: "/api/providers", pathname: "/dashboard/providers", params: {}, failure: "http", loadedText: "OpenAI" });

export const MalformedResponseAndRetry = failedReadStory({ routes: baseRoutes, url: "/api/providers", pathname: "/dashboard/providers", params: {}, failure: "malformed", loadedText: "OpenAI" });

export const NetworkFailureAndRetry = failedReadStory({ routes: baseRoutes, url: "/api/providers", pathname: "/dashboard/providers", params: {}, failure: "network", loadedText: "OpenAI" });

function rejectedToggleStory(partial = false) {
  let acceptRetry = false;
  let records;
  const reset = () => { records = [{ ...connection }, { ...connection, id: "openai-backup" }]; acceptRetry = false; };
  reset();
  return {
    beforeEach: reset,
    parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes: {
      ...baseRoutes,
      "GET /api/providers": () => ({ body: { connections: records } }),
      "PUT /api/providers/openai-main": async (request) => {
        if (!acceptRetry && !partial) return { status: 503, body: { error: "Rejected" } };
        records[0] = { ...records[0], ...await request.json() }; return { body: records[0] };
      },
      "PUT /api/providers/openai-backup": async (request) => {
        if (!acceptRetry) return { status: 503, body: { error: "Rejected" } };
        records[1] = { ...records[1], ...await request.json() }; return { body: records[1] };
      },
    } } },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const status = await canvas.findByLabelText("Provider status");
      await userEvent.click(status);
      await userEvent.click(await within(document.body).findByRole("option", { name: "All", exact: true }));
      const toggle = await canvas.findByRole("switch", { name: "Disable OpenAI" });
      await userEvent.click(toggle);
      const alert = await canvas.findByRole("alert");
      await expect(alert).toHaveTextContent(partial ? "1 of 2" : "2 of 2");
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      acceptRetry = true;
      await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
      await expect(await canvas.findByRole("switch", { name: "Enable OpenAI" })).toHaveAttribute("aria-checked", "false");
    },
  };
}
export const RejectedToggleAndRetry = rejectedToggleStory();
export const PartiallyRejectedToggle = rejectedToggleStory(true);

export const ProviderTogglePending = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes: { ...baseRoutes,
    "PUT /api/providers/openai-main": () => new Promise(() => {}),
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("switch", { name: "Disable OpenAI" });
    await userEvent.click(toggle);
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  },
};
