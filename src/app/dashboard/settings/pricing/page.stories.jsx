import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import PricingSettingsPage from "./page";

const pricing = {
  openai: { "gpt-4o": { input: 2.5, output: 10 } },
  anthropic: { "claude-3-5-sonnet": { input: 3, output: 15 } },
};

const meta = {
  title: "Production/profile/PricingSettingsPage",
  component: PricingSettingsPage,
  parameters: {
    layout: "fullscreen",
    storyFixture: { scenario: "default", pathname: "/dashboard/settings/pricing", routes: { "GET /api/pricing": { body: pricing } } },
  },
};

export default meta;

export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Pricing Settings" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Edit Pricing" }));
    const body = canvasElement.ownerDocument.body;
    await waitFor(() => expect(within(body).getByRole("dialog", { name: "Pricing Configuration" })).toBeVisible());
    const dialog = within(body).getByRole("dialog", { name: "Pricing Configuration" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
  },
};

export const EmptyPricing = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/settings/pricing",
      // Storybook deep-merges parameters, so an object body would merge into the
      // meta fixture and keep its models. A function descriptor replaces it.
      routes: { "GET /api/pricing": () => ({ body: {} }) },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No pricing data available")).toBeVisible();
    await expect(canvas.getByText("Add pricing rates to enable cost tracking.")).toBeVisible();
    await expect(canvas.getAllByRole("button", { name: "Edit Pricing" })).toHaveLength(2);
  },
};
