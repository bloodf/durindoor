import React from "react";
import { expect, userEvent, within } from "storybook/test";

import PlaygroundCompare from "./PlaygroundCompare.jsx";

const models = [
  { id: "codex/gpt-5.2-codex", requestModel: "codex/gpt-5.2-codex", name: "GPT-5.2 Codex", providerId: "codex", providerName: "Codex" },
  { id: "claude/claude-sonnet-4-5", requestModel: "claude/claude-sonnet-4-5", name: "Claude Sonnet 4.5", providerId: "claude", providerName: "Claude" },
];

const providerGroups = [
  { providerId: "codex", providerName: "Codex", connections: [{ id: "codex-primary", name: "Codex Primary" }, { id: "codex-backup", name: "Codex Backup" }], models: [models[0]] },
  { providerId: "claude", providerName: "Claude", connections: [{ id: "claude-primary" }], models: [models[1]] },
];

const routes = {
  "GET /api/pricing": { body: { codex: { "gpt-5.2-codex": { input: 1.25, output: 10 } } } },
  "POST /v1/chat/completions": {
    status: 200,
    events: [
      { choices: [{ delta: { content: "Compared " } }] },
      { choices: [{ delta: { content: "answer." } }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
      "[DONE]",
    ],
  },
};

const meta = {
  title: "Production/playground/PlaygroundCompare",
  component: PlaygroundCompare,
  args: { modelOptions: models, providerGroups, content: "Explain this fixture", reasoningEffort: "auto" },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Compare panel: one composer prompt streamed to 2-4 models, each column with its own model, connection, stop, copy, latency, first-token and estimated cost." } },
    storyFixture: { scenario: "default", pathname: "/dashboard/playground", params: {}, routes },
  },
  decorators: [(Story) => <div className="flex h-[720px] flex-col bg-dd-bg p-4 text-dd-text"><Story /></div>],
};

export default meta;

export const TwoColumns = {};

export const RunsAllColumns = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Run all" }));
    const answers = await canvas.findAllByText("Compared answer.");
    await expect(answers).toHaveLength(2);
  },
};

export const NoModels = {
  args: { modelOptions: [], providerGroups: [] },
};
