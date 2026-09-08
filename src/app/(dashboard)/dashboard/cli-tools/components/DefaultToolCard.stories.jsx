import React from "react";
import { expect, userEvent, waitFor, within, spyOn } from "storybook/test";
import DefaultToolCard from "./DefaultToolCard";
import { CLI_TOOLS } from "@/shared/constants/cliTools";

const activeProviders = [{
  id: "openai-main",
  provider: "openai",
  authType: "apikey",
  name: "OpenAI",
  isActive: true,
  testStatus: "active",
  priority: 1,
  providerSpecificData: {},
}];

const get = (body) => (request) => {
  if (request.method !== "GET") throw new Error(`Expected GET, received ${request.method}`);
  return { body };
};

// ModelSelectModal requests these exact production endpoints only after its
// real Select Model control opens. Route handlers receive native Request.
const modelPickerRoutes = {
  "GET /api/settings": get({ cloudEnabled: false, hidePaidModels: false }),
  "GET /api/combos": get({ combos: [] }),
  "GET /api/provider-nodes": get({ nodes: [] }),
  "GET /api/models/custom": get({ models: [] }),
  "GET /api/models/disabled": get({ disabled: {} }),
};

const qwenArgs = {
  toolId: "qwen",
  tool: CLI_TOOLS.qwen,
  isExpanded: true,
  onToggle: () => {},
  baseUrl: "https://durindoor.example.test",
  apiKeys: [{ id: "key-primary", name: "Primary", maskedKey: "sk_••••story" }],
  activeProviders,
};

export default {
  title: "Durin DS/Production Pages/cli-tools/DefaultToolCard",
  component: DefaultToolCard,
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/cli-tools/qwen",
      params: { toolId: "qwen" },
      routes: modelPickerRoutes,
    },
  },
};

/** Qwen guide: image icon, info/warning/error notes, API key, model picker, rendered JSON and copy controls. */
export const QwenGuideConfigured = {
  args: qwenArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByAltText("Qwen Code")).toBeVisible();
    await expect(canvas.getByText(/OAuth free tier was discontinued/i)).toBeVisible();

    const apiKey = canvas.getByPlaceholderText("sk_durindoor or a saved secret");
    await userEvent.type(apiKey, "sk_story-selected");
    await expect(apiKey).toHaveValue("sk_story-selected");

    await userEvent.click(canvas.getByRole("button", { name: "Select Model" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Select Model" });
    await expect(dialog).toBeVisible();
    const gpt41 = await waitFor(() => {
      const button = Array.from(dialog.querySelectorAll("button")).find((node) => Array.from(node.querySelectorAll("span")).some((span) => span.firstChild?.nodeType === Node.TEXT_NODE && span.firstChild.nodeValue === "GPT-4.1"));
      expect(button).toBeDefined();
      return button;
    });
    await userEvent.click(gpt41);
    const model = canvas.getByPlaceholderText("provider/model-id");
    await expect(model).toHaveValue("openai/gpt-4.1");
    await expect(canvas.getByText("sk_story-selected", { exact: false })).toBeVisible();
    await expect(canvas.getByText("openai/gpt-4.1", { exact: false })).toBeVisible();
    const clipboard = spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
      await waitFor(() => expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("sk_story-selected")));
      expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("openai/gpt-4.1"));
    } finally { clipboard.mockRestore(); }
  },
};

/** Cursor's real external-only config hides guide steps without Cloud or Tunnel and keeps required warning/error notes. */
export const CursorExternalUrlUnavailable = {
  args: {
    ...qwenArgs,
    toolId: "cursor",
    tool: CLI_TOOLS.cursor,
    activeProviders: [],
  },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/cli-tools/cursor",
      params: { toolId: "cursor" },
      routes: modelPickerRoutes,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Requires Cursor Pro account/i)).toBeVisible();
    await expect(canvas.getByText(/local endpoint is not supported/i)).toBeVisible();
    await expect(canvas.queryByText("Open Settings")).not.toBeInTheDocument();
  },
};
