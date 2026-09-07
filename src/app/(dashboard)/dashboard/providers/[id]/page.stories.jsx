import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ProviderDetailPage from "./page";

const baseConnection = {
  id: "openai-main",
  provider: "openai",
  authType: "apikey",
  name: "Production",
  isActive: true,
  testStatus: "active",
  priority: 1,
  providerSpecificData: {},
};

const baseRoutes = {
  "GET /api/providers": { body: { connections: [baseConnection] } },
  "GET /api/provider-nodes": { body: { nodes: [] } },
  "GET /api/proxy-pools": { body: { proxyPools: [] } },
  "GET /api/settings": {
    body: {
      providerStrategies: {},
      providerThinking: {},
      providerConcurrencyLimits: {},
      retryDelayByProvider: {},
      rpmByProvider: {},
    },
  },
  "GET /api/models/alias": { body: { aliases: {} } },
  "GET /api/models/custom": { body: { models: [] } },
  "GET /api/models/disabled": { body: { ids: [] } },
};
const openaiMeta = {
  title: "Production/providers/ProviderDetailPage",
  component: ProviderDetailPage,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/openai",
      params: { id: "openai" },
      routes: baseRoutes,
    },
  },
};

export default openaiMeta;

/** Live detail view. Parent scenario reaches ConnectionRow, ModelRow, and shared detail modals through their real triggers. */
export const OpenAIDetail = {};

/** DS Retry-delay and Thinking-mode listboxes use real settings handlers; the request shape matches the page's settings fetch. */
export const SettingsControls = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const retryDelay = await canvas.findByLabelText("Retry delay");
    await userEvent.click(retryDelay);
    await userEvent.click(await within(document.body).findByRole("option", { name: "Retry: 15s" }));
    await expect(retryDelay).toHaveTextContent("Retry: 15s");
  },
};

/** Compatible provider branch renders CompatibleModelsSection and opens private bulk proxy controls. */
export const CompatibleBranch = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/oc-prod",
      params: { id: "oc-prod" },
      routes: {
        ...baseRoutes,
        "GET /api/proxy-pools": { body: { proxyPools: [{ id: "pool-eu", name: "EU Pool", isActive: true }] } },
        "GET /api/provider-nodes": {
          body: {
            nodes: [
              {
                id: "oc-prod",
                name: "OpenAI Compatible (Prod)",
                prefix: "oc-prod",
                apiType: "chat",
                baseUrl: "https://api.openai.com/v1",
                type: "openai-compatible",
              },
            ],
          },
        },
        "GET /api/providers": {
          body: {
            connections: [
              {
                ...baseConnection,
                id: "oc-prod-main",
                provider: "oc-prod",
              },
            ],
          },
        },
        "GET /api/models/disabled": { body: { ids: [] } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "Apply Proxy" }));
    const dialog = await waitFor(() => {
      const node = body.getByRole("dialog", { name: /apply proxy \(1 connections\)/i });
      expect(node).toBeVisible();
      return node;
    });
    const dialogScope = within(dialog);
    await expect(dialogScope.getByText("One-to-one (rotate)")).toBeVisible();
    await expect(dialogScope.getByText("EU Pool")).toBeVisible();
    await userEvent.click(dialogScope.getByRole("button", { name: /^cancel$/i }));
  },
};
