import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ModelSelectModal from "./ModelSelectModal.js";

const COMBOS = [
  { id: "combo-fast", name: "fast" },
  { id: "combo-pro", name: "pro" },
];

// Real registry model id (alias `anthropic` from open-sse/providers/registry/anthropic.js
// + the versioned catalog id `claude-sonnet-4-5-20250929`). ModelSelectModal
// builds the chip value as `${alias}/${m.id}`.
const ANTHROPIC_SONNET_4_5 = "anthropic/claude-sonnet-4-5-20250929";

const buildRoutes = () => ({
  "GET /api/settings": async () => ({ body: { hidePaidModels: false } }),
  "GET /api/v1/models": async () => ({ body: { data: [] } }),
  "GET /api/combos": async () => ({ body: { combos: COMBOS } }),
  "GET /api/provider-nodes": async () => ({ body: { nodes: [] } }),
  "GET /api/models/custom": async () => ({ body: { models: [] } }),
  "GET /api/models/disabled": async () => ({ body: { disabled: {} } }),
});

export default {
  title: "Production/shared-config/ModelSelectModal",
  component: ModelSelectModal,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      routes: buildRoutes(),
    },
  },
  argTypes: {
    isOpen: { control: "boolean" },
    title: { control: "text" },
    selectedModel: { control: "text" },
    kindFilter: { control: "select", options: [null, "llm", "embedding", "image", "tts"] },
  },
};

const activeProviders = [
  { provider: "anthropic", id: "anth-1" },
  { provider: "openai", id: "oai-1" },
  { provider: "google", id: "goog-1" },
];

const callbacks = {
  onClose: () => {},
  onSelect: () => {},
  onDeselect: () => {},
};

export const OpenLLM = {
  args: { isOpen: true, title: "Select Model", activeProviders, ...callbacks },
  render: (args) => <ModelSelectModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Select Model" });
    await waitFor(() => {
      expect(within(dialog).getByText(/^Combos$/)).toBeInTheDocument();
    });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Search models" }), "claude");
  },
};

export const WithSelection = {
  args: {
    isOpen: true,
    title: "Select Model",
    activeProviders,
    selectedModel: ANTHROPIC_SONNET_4_5,
    addedModelValues: [ANTHROPIC_SONNET_4_5],
    ...callbacks,
  },
  render: (args) => <ModelSelectModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Select Model" });
    const chip = await waitFor(() => within(dialog).getByRole("button", { name: /^Claude Sonnet 4\.5\b/ }));
    expect(chip).toHaveAttribute("aria-pressed", "true");
  },
};

export const WithCombosAndSelection = {
  args: {
    isOpen: true,
    title: "Select Model",
    activeProviders,
    selectedModel: "fast",
    addedModelValues: ["fast", ANTHROPIC_SONNET_4_5],
    ...callbacks,
  },
  render: (args) => <ModelSelectModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Select Model" });
    const fastChip = await waitFor(() => within(dialog).getByRole("button", { name: /^fast\b/ }));
    expect(fastChip).toHaveAttribute("aria-pressed", "true");
  },
};

export const EmbeddingKind = {
  args: {
    isOpen: true,
    title: "Select Embedding Model",
    kindFilter: "embedding",
    activeProviders,
    ...callbacks,
  },
  render: (args) => <ModelSelectModal {...args} />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding",
      routes: buildRoutes(),
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Select Embedding Model" });
    expect(within(dialog).queryByText(/^Combos$/)).toBeNull();
  },
};

export const Closed = {
  args: { isOpen: false, activeProviders, ...callbacks },
  render: (args) => <ModelSelectModal {...args} />,
};
