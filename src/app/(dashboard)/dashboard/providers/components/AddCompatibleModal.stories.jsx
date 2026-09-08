import React from "react";
import { expect, userEvent, within } from "storybook/test";

import AddCompatibleModal from "./AddCompatibleModal";


const validRoutes = {
  "POST /api/provider-nodes/validate": {
    body: { valid: true, method: "chat" },
  },
  "POST /api/provider-nodes": {
    body: { node: { id: "oc-test", name: "Test", prefix: "oc-test", apiType: "chat", baseUrl: "https://api.openai.com/v1", type: "openai-compatible" } },
  },
};

const invalidRoutes = {
  "POST /api/provider-nodes/validate": {
    body: { valid: false, error: "HTTP 401 from base URL" },
  },
  "POST /api/provider-nodes": {
    body: { error: "Base URL must end with /v1" },
  },
};

const meta = {
  title: "Production/providers/components/AddCompatibleModal",
  component: AddCompatibleModal,
  parameters: {
    layout: "fullscreen",
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: validRoutes },
  },
};

export default meta;

const Wrap = ({ variant }) => {
  const [open, setOpen] = React.useState(true);
  return (
    <AddCompatibleModal
      variant={variant}
      isOpen={open}
      onClose={() => setOpen(false)}
      onCreated={() => setOpen(false)}
    />
  );
};

export const OpenAIOpen = {
  render: () => <Wrap variant="openai" />,
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByRole("dialog", { name: /add openai compatible/i })).toBeVisible();
  },
};

/** Anthropic Compatible flow: no API Type Select (chat-only path). Check button posts to /api/provider-nodes/validate. */
export const AnthropicInvalid = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: invalidRoutes },
  },
  render: () => <Wrap variant="anthropic" />,
  play: async () => {
    const body = within(document.body);
    const dialog = await body.findByRole("dialog", { name: /add anthropic compatible/i });
    const dialogScope = within(dialog);
    const baseUrl = await dialogScope.findByLabelText("Base URL");
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, "https://example.com/v1");
    await userEvent.type(dialogScope.getByLabelText("API Key (for Check)"), "sk-test");
    await userEvent.click(dialogScope.getByRole("button", { name: "Check" }));
    await expect(await dialogScope.findByText("Invalid")).toBeInTheDocument();
  },
};
