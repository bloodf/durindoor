import React from "react";
import { expect, userEvent, within } from "storybook/test";

import EditConnectionModal from "./EditConnectionModal.js";

export default {
  title: "Production/shared-config/EditConnectionModal",
  component: EditConnectionModal,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      routes: {
        "POST /api/providers/validate": async (request) => {
          const body = await request.json().catch(() => ({}));
          const valid = Boolean(body && body.apiKey && body.apiKey.length > 3);
          return { body: { valid, error: valid ? null : "Key rejected" }, status: 200 };
        },
        "POST /api/providers/provider-1/test": async () => ({ body: { valid: true }, status: 200 }),
        "POST /api/providers/provider-2/test": async () => ({ body: { valid: false, error: "Auth failed" }, status: 200 }),
      },
    },
  },
  argTypes: {
    isOpen: { control: "boolean" },
    connection: { control: "object" },
  },
};

const baseConnection = {
  id: "provider-1",
  name: "Production Key",
  email: null,
  priority: 1,
  authType: "apikey",
  provider: "openai",
  providerSpecificData: {},
};

export const ApiKeyOpenAI = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, provider: "openai", name: "OpenAI Production" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(dialog).toBeInTheDocument();
    const apiKeyField = within(dialog).getByLabelText("API Key");
    await userEvent.type(apiKeyField, "sk-validkey");
    const check = within(dialog).getByRole("button", { name: "Check" });
    await userEvent.click(check);
  },
};

export const OAuthAccount = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, authType: "oauth", email: "[email protected]", name: "Claude Max" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(within(dialog).getByText("[email protected]")).toBeInTheDocument();
    await expect(within(dialog).queryByLabelText("API Key")).toBeNull();
  },
};

export const AzurePanel = {
  args: {
    isOpen: true,
    connection: {
      ...baseConnection,
      provider: "azure",
      name: "Azure OpenAI",
      providerSpecificData: {
        azureEndpoint: "https://example.openai.azure.com",
        apiVersion: "2024-10-01-preview",
        deployment: "gpt-4",
        organization: "11111111-1111-1111-1111-111111111111",
      },
    },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(within(dialog).getByText("Azure OpenAI Configuration")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText("Deployment Name"));
  },
};

export const GooglePsePanel = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, provider: "google-pse", name: "Google PSE" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(within(dialog).getByText("Google Programmable Search")).toBeInTheDocument();
    const cx = within(dialog).getByLabelText("Search Engine ID (cx)");
    await userEvent.type(cx, "0123456789:abcdef");
  },
};

export const CodexFingerprintPanel = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, authType: "oauth", provider: "codex", name: "Codex OAuth", providerSpecificData: { codexFingerprintMode: "device" } },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    const trigger = within(dialog).getByRole("combobox", { name: "OAuth fingerprint mode" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
  },
};

export const CloudflareAccountIdPanel = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, provider: "cloudflare-ai", name: "Cloudflare Workers AI" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(within(dialog).getByText("Cloudflare Workers AI")).toBeInTheDocument();
  },
};

export const SnowflakeAccountIdPanel = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, provider: "snowflake", name: "Snowflake" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(within(dialog).getByText("Snowflake Cortex")).toBeInTheDocument();
  },
};

export const OpenAIResponsesStore = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, provider: "openai-compatible-responses-chat-1", name: "Compatible Responses" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    const toggle = within(dialog).getByRole("switch", { name: "OpenAI Responses store" });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  },
};

export const RegionPickerXiaomi = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, provider: "xiaomi-tokenplan", name: "Xiaomi", providerSpecificData: { region: "cn" } },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await expect(within(dialog).getByRole("combobox", { name: "Region" })).toBeInTheDocument();
  },
};

export const TestFailureBadge = {
  args: {
    isOpen: true,
    connection: { ...baseConnection, id: "provider-2", provider: "anthropic", name: "Anthropic" },
    onClose: () => {},
    onSave: (updates) => { /* eslint-disable-next-line no-console */ console.log("save", updates); },
  },
  render: (args) => <EditConnectionModal {...args} />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      routes: {
        "POST /api/providers/provider-2/test": async () => ({ body: { valid: false, error: "Auth failed" }, status: 200 }),
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Connection" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Test Connection" }));
    await expect(within(dialog).findByText("Failed")).resolves.toBeInTheDocument();
  },
};

export const Closed = {
  args: {
    isOpen: false,
    connection: { ...baseConnection },
    onClose: () => {},
    onSave: () => {},
  },
  render: (args) => <EditConnectionModal {...args} />,
};
