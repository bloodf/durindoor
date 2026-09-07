import React from "react";
import { expect, userEvent, within } from "storybook/test";

import ManualConfigModal from "./ManualConfigModal.js";

export default {
  title: "Production/shared-config/ManualConfigModal",
  component: ManualConfigModal,
  parameters: { layout: "fullscreen" },
  argTypes: {
    isOpen: { control: "boolean" },
    title: { control: "text" },
    configs: { control: "object" },
  },
};

const SAMPLE = [
  {
    filename: "claude.json",
    content: JSON.stringify(
      { env: { ANTHROPIC_BASE_URL: "http://localhost:3000/api/v1" }, providers: [{ id: "claude", name: "Claude" }] },
      null,
      2,
    ),
  },
  {
    filename: "codex.toml",
    content: "model = \"gpt-5\"\nbase_url = \"http://localhost:3000/api/v1\"\nprovider = \"openai\"",
  },
];

export const Open = {
  args: {
    isOpen: true,
    title: "Manual Configuration",
    configs: SAMPLE,
    onClose: () => {},
  },
  render: (args) => <ManualConfigModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Manual Configuration" });
    const claudeSection = within(dialog).getByText("claude.json").closest("section");
    expect(claudeSection).not.toBeNull();
    // Two config sections render their own Copy button; scope the click to the
    // section we just resolved to avoid the "multiple elements" collision.
    await userEvent.click(within(claudeSection).getByRole("button", { name: "Copy" }));
    await expect(within(claudeSection).getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  },
};

export const LongContent = {
  args: {
    isOpen: true,
    title: "CLI Manual",
    configs: [
      {
        filename: "shell.sh",
        content: Array.from({ length: 80 })
          .map((_, i) => `export TOKEN_${i}=very-long-secret-value-${i}-abcdef0123456789`)
          .join("\n"),
      },
      ...SAMPLE,
    ],
    onClose: () => {},
  },
  render: (args) => <ManualConfigModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "CLI Manual" });
    expect(within(dialog).getByText("shell.sh").closest("section")).not.toBeNull();
  },
};

export const Empty = {
  args: {
    isOpen: true,
    title: "Manual Configuration",
    configs: [],
    onClose: () => {},
  },
  render: (args) => <ManualConfigModal {...args} />,
  play: async () => {
    // Source renders a dialog with no <section> children when configs is
    // empty; assert the dialog itself is open and no filename section exists.
    const dialog = await within(document.body).findByRole("dialog", { name: "Manual Configuration" });
    expect(within(dialog).queryByText("claude.json")).toBeNull();
  },
};

export const Closed = {
  args: {
    isOpen: false,
    title: "Manual Configuration",
    configs: SAMPLE,
    onClose: () => {},
  },
  render: (args) => <ManualConfigModal {...args} />,
};
