import React from "react";
import { expect, userEvent, within } from "storybook/test";

import ModelAvailabilityBadge from "./ModelAvailabilityBadge";

const healthyRoutes = {
  "GET /api/models/availability": {
    body: {
      unavailableCount: 0,
      models: [
        { provider: "openai", model: "gpt-4o", status: "available" },
        { provider: "anthropic", model: "claude-3-5-sonnet", status: "available" },
      ],
    },
  },
};

const unhealthyRoutes = {
  "GET /api/models/availability": {
    body: {
      unavailableCount: 2,
      models: [
        { provider: "openai", model: "gpt-4o", status: "available" },
        { provider: "anthropic", model: "claude-3-5-sonnet", status: "cooldown" },
        { provider: "groq", model: "mixtral-8x7b", status: "unavailable" },
      ],
    },
  },
  "POST /api/models/availability": { body: { ok: true } },
};

const meta = {
  title: "Production/providers/components/ModelAvailabilityBadge",
  component: ModelAvailabilityBadge,
  parameters: {
    layout: "centered",
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: healthyRoutes },
  },
};

export default meta;

/** Healthy state: emerald trigger button shows "All models operational" with `aria-expanded=false`. */
export const Healthy = {};

/** Unhealthy state: amber trigger button, popover lists per-provider cooldowns/unavailable with clear actions. */
export const WithIssuesOpen = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: unhealthyRoutes },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /models with issues/i });
    await userEvent.click(trigger);
    await expect(await canvas.findByText("Model Status")).toBeInTheDocument();
    await expect(await canvas.findByText("claude-3-5-sonnet")).toBeInTheDocument();
  },
};
