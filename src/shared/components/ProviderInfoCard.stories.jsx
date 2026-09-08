import React from "react";
import { expect, within } from "storybook/test";

import ProviderInfoCard from "./ProviderInfoCard";

globalThis.React ??= React;

const sampleConfig = {
  mode: "chat",
  defaultModel: "claude-sonnet-4-5",
  baseUrl: "https://api.example.com/v1",
  costPerQuery: 0.0024,
  pricingUrl: "https://example.com/pricing",
  freeTier: "No",
  freeMonthlyQuota: 0,
  searchTypes: ["news", "general"],
  formats: ["markdown", "html"],
  maxMaxResults: 10,
  maxCharacters: 4096,
};

const sampleProvider = {
  website: "https://example.com",
  notice: {
    apiKeyUrl: "https://example.com/dashboard/keys",
    text: "Provider requires organization-scoped keys.",
  },
};

const meta = {
  title: "Production/shared-provider/ProviderInfoCard",
  component: ProviderInfoCard,
  parameters: {
    layout: "padded",
    storyFixture: { scenario: "default", pathname: "/dashboard/providers" },
  },
};

export default meta;

export const FullCard = {
  args: {
    config: sampleConfig,
    provider: sampleProvider,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Provider Info")).toBeInTheDocument();
    await expect(canvas.getByText("claude-sonnet-4-5")).toBeInTheDocument();
    await expect(canvas.getByText("Get API Key")).toBeInTheDocument();
    await expect(canvas.getByText("Provider requires organization-scoped keys.")).toBeInTheDocument();
  },
};

export const NoConfigReturnsNull = {
  args: { config: null, provider: null },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe("");
  },
};
