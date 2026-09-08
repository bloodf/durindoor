import React from "react";
import { expect, userEvent, within } from "storybook/test";

import PlaygroundPageClient from "./PlaygroundPageClient";

const STORAGE_KEYS = [
  "basic-chat.sessions",
  "basic-chat.activeSessionId",
  "basic-chat.activeProviderId",
  "basic-chat.draft",
  "playground.reasoningEffort",
  "playground.activeConnectionId",
];

function clearPlaygroundStorage() {
  for (const key of STORAGE_KEYS) globalThis.localStorage?.removeItem(key);
}

function seedHistory() {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    id: `seed-${index + 1}`,
    title: `Fixture chat ${index + 1}`,
    providerId: "codex",
    providerName: "Codex",
    modelId: "codex/gpt-5.2-codex",
    modelName: "GPT-5.2 Codex",
    createdAt: new Date(Date.now() - index * 60000).toISOString(),
    updatedAt: new Date(Date.now() - index * 60000).toISOString(),
    messages: [{ id: `m${index}`, role: "user", content: `Fixture message ${index + 1}` }],
  }));
  globalThis.localStorage.setItem("basic-chat.sessions", JSON.stringify(sessions));
  globalThis.localStorage.setItem("basic-chat.activeSessionId", "seed-1");
}

const connections = {
  connections: [
    { id: "codex-primary", provider: "codex", name: "Codex Primary", isActive: true },
    { id: "codex-backup", provider: "codex", name: "Codex Backup", isActive: true },
    { id: "claude-primary", provider: "claude", name: "Claude Primary", isActive: true },
  ],
};

const models = {
  data: [
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { id: "gpt-5.2-mini", name: "GPT-5.2 Mini" },
  ],
};

const claudeModels = {
  data: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
};

const baseRoutes = {
  "GET /api/providers": { body: connections },
  "GET /api/providers/codex-primary/models": { body: models },
  "GET /api/providers/codex-backup/models": { body: models },
  "GET /api/providers/claude-primary/models": { body: claudeModels },
};

const completionSseEvents = [
  { choices: [{ delta: { content: "Hello " } }] },
  { choices: [{ delta: { content: "from " } }] },
  { choices: [{ delta: { content: "DurinDoor." } }] },
  "[DONE]",
];

const meta = {
  title: "Production/playground/PlaygroundPageClient",
  component: PlaygroundPageClient,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Real playground client. Parent scenarios cover empty state, private model-list keyboard/mouse selection, streamed response, persisted chat history with pagination, and request-error badges through live route fixtures."
      },
    },
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/playground",
      params: {},
      routes: baseRoutes,
    },
  },
};

export default meta;

export const EmptyConversation = {
  beforeEach: clearPlaygroundStorage,
};

export const SendsCompletion = {
  beforeEach: clearPlaygroundStorage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/playground",
      params: {},
      routes: {
        ...baseRoutes,
        "POST /v1/chat/completions": { status: 200, events: completionSseEvents },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByLabelText("Message input");
    await userEvent.type(input, "Explain this fixture");
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));
    await expect(await canvas.findByText("Hello from DurinDoor.")).toBeVisible();
  },
};

export const ModelMenuProviderSwitch = {
  beforeEach: clearPlaygroundStorage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/playground",
      params: {},
      routes: baseRoutes,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("combobox", { expanded: false, name: /^Model / });
    await userEvent.click(trigger);
    await expect(canvas.getByRole("listbox")).toBeVisible();
    const claudeOption = await canvas.findByRole("option", { name: "Claude Sonnet 4.5 claude-sonnet-4-5" });
    await userEvent.click(claudeOption);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    await expect(canvas.getByRole("option", { name: "Claude Sonnet 4.5 claude-sonnet-4-5", selected: true })).toBeInTheDocument();
    await expect(within(trigger).getByText("Claude Sonnet 4.5")).toBeVisible();
    await expect(within(trigger).getByText("claude-sonnet-4-5")).toBeVisible();
  },
};
export const ChatHistoryPopover = {
  beforeEach: () => {
    clearPlaygroundStorage();
    seedHistory();
  },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/playground",
      params: {},
      routes: baseRoutes,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "History" }));
    const dialog = await canvas.findByRole("dialog", { name: "Chat history" });
    await expect(within(dialog).getByText("Fixture chat 1")).toBeVisible();
    await expect(within(dialog).getByRole("navigation", { name: "Pagination" })).toBeVisible();
  },
};

export const CompletionError = {
  beforeEach: clearPlaygroundStorage,
  parameters: {
    storyFixture: {
      scenario: "error",
      pathname: "/dashboard/playground",
      params: {},
      routes: {
        ...baseRoutes,
        "POST /v1/chat/completions": { status: 503, body: { error: "Fixture provider unavailable." } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByLabelText("Message input");
    await userEvent.type(input, "Trigger fixture error");
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));
    await expect(await canvas.findByText("Error", { exact: true })).toBeVisible();
  },
};
