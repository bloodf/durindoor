import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import ApiKeyPolicyFields from "./ApiKeyPolicyFields";
import { emptyApiKeyPolicyDraft } from "../apiKeyPolicy";

const catalog = [
  { id: "gpt-5", displayId: "gpt-5", name: "GPT-5", provider: "openai" },
  { id: "claude-4", displayId: "claude-4", name: "Claude 4", provider: "anthropic" },
];

function Wrapper(props) {
  const [draft, setDraft] = useState(props.draft);
  return <ApiKeyPolicyFields {...props} draft={draft} onChange={setDraft} />;
}

const meta = {
  title: "Production/endpoint/ApiKeyPolicyFields",
  component: ApiKeyPolicyFields,
  parameters: { layout: "padded" },
  render: (args) => <Wrapper {...args} />,
  args: {
    draft: emptyApiKeyPolicyDraft(),
    catalog,
    loading: false,
  },
};

export default meta;

/** Default "all models" scope hides the model search list. */
export const AllModels = {};

/** Selecting "Selected models" reveals the searchable model checklist. */
export const SelectedModelsScope = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scoped = await canvas.findByRole("radio", { name: "Selected models" });
    await userEvent.click(scoped);
    const gpt5 = await canvas.findByRole("checkbox", { name: /^GPT-5\s+gpt-5$/ });
    await expect(gpt5.closest("label")).toBeVisible();
    await userEvent.click(gpt5);
    await expect(gpt5).toBeChecked();
  },
};

/** Loading state disables the model list while the catalog fetch is pending. */
export const CatalogLoading = {
  args: { draft: { ...emptyApiKeyPolicyDraft(), accessMode: "selected" }, loading: true },
};

/** Committed usage near the lifetime cap renders the danger-tone summary line. */
export const UsageLimitReached = {
  args: {
    draft: { accessMode: "all", allowedModels: [], maxTokens: "1000", maxCostUsd: "1" },
    usage: { totalTokens: 5000, totalCost: 5, totalRequests: 12 },
  },
};
