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
      unavailableCount: 5,
      models: [
        {
          provider: "anthropic",
          model: "__all",
          status: "cooldown",
          until: "2026-09-12T18:30:00.000Z",
          connectionId: "anthropic-primary",
          connectionName: "Production account",
          lastError: "Rate limit reached",
        },
        {
          provider: "anthropic",
          model: "__all",
          status: "cooldown",
          until: "2026-09-12T18:30:00.000Z",
          connectionId: "anthropic-primary",
          connectionName: "Production account",
          lastError: "Rate limit reached",
        },
        {
          provider: "anthropic",
          model: "__all",
          status: "unavailable",
          connectionId: "anthropic-backup",
          connectionName: "Backup account",
          lastError: "Authentication failed",
        },
        {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          status: "cooldown",
          until: "2026-09-12T18:45:00.000Z",
          connectionId: "anthropic-backup",
          connectionName: "Backup account",
          lastError: "Capacity temporarily exhausted",
        },
        {
          provider: "groq",
          model: "__all",
          status: "unavailable",
          connectionId: "groq-team",
          connectionName: "Team account",
          lastError: "Authentication failed",
        },
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

/** Unhealthy state: provider/account groups explain account-wide and model-specific issues without exposing sentinels. */
export const WithIssuesOpen = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: unhealthyRoutes },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /models with issues/i });
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole("dialog", { name: "Model Status" });
    await expect(within(dialog).getByText("Production account")).toBeInTheDocument();
    await expect(within(dialog).getByText("Backup account")).toBeInTheDocument();
    await expect(within(dialog).getByText("All models")).toBeInTheDocument();
    await expect(within(dialog).getByText("claude-sonnet-4-5")).toBeInTheDocument();
    await expect(dialog).not.toHaveTextContent("__all");
  },
};
