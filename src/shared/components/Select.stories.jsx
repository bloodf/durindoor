import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Select from "./Select.js";

/**
 * Production lane coverage map for `Select`. Visual widget lives in the owned
 * production file. Verified owned importers: `combos/page.js`,
 * `playground/PlaygroundPageClient.js`, `providers/[id]/{AddApiKeyModal,
 * BulkImportCodexModal, EditCompatibleNodeModal,page}.js`,
 * `providers/components/{AddCompatibleModal,ConnectionsCard}.js`,
 * `usage/page.js`, `shared/components/EditConnectionModal.js`, and
 * `shared/components/OAuthModal.js`.
 *
 * These stories cover their shared selection states plus private widget axes:
 * label/hint/error wrapper, disabled option, no-options listbox, icon/hint
 * option content, placement="top", and Escape return-to-trigger behavior.
 */
const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI", icon: "auto_awesome" },
  { value: "google", label: "Google", icon: "diamond", hint: "Long context" },
  { value: "codex", label: "Codex", disabled: true },
];

const meta = {
  title: "Production/shared-actions/Select",
  component: Select,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Owned production Select. Verified consumers: combo strategy, Playground controls, provider API-key/import/edit modals, ConnectionsCard, Usage, EditConnectionModal, OAuthModal. Preserves synthetic `onChange({ target: { value } })`, 44px listbox interactions, body portal z-[70], keyboard/typeahead, and focus return.",
      },
    },
  },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
};

export default meta;

export const Standalone = {
  render: () => <Select placeholder="Select provider" options={PROVIDERS} aria-label="Provider" />,
};

export const ModalFormFields = {
  name: "EditConnectionModal / OAuthModal form fields",
  render: () => (
    <div className="space-y-3">
      <Select label="Provider" required options={PROVIDERS} hint="Determines request translation." />
      <Select label="Faulty choice" options={PROVIDERS} error="Provider connection failed." />
    </div>
  ),
};

export const ToolbarPlacement = {
  name: "Usage / ConnectionsCard top placement",
  render: () => <Select options={PROVIDERS} value="openai" placement="top" aria-label="Connection provider" />,
};

export const EmptyOptions = {
  name: "No options (private widget)",
  render: () => <Select options={[]} placeholder="No provider accounts available" aria-label="Empty provider" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Empty provider" }));
    await expect(await within(document.body).findByRole("listbox", { name: "Empty provider" })).toHaveTextContent("No provider accounts available");
  },
};

function ControlledSelectDemo() {
  const [value, setValue] = useState("anthropic");
  return (
    <div className="space-y-3">
      <Select
        label="Provider"
        options={PROVIDERS}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <output aria-live="polite" className="text-[13px] text-dd-muted">Current: {value}</output>
    </div>
  );
}

export const WorkingSelection = {
  render: () => <ControlledSelectDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: /Provider/i });
    await userEvent.click(trigger);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(canvas.getByText(/Current: openai/)).toBeInTheDocument();
  },
};

export const EscapeCloses = {
  name: "Escape closes and restores trigger focus (private widget)",
  render: () => <Select options={PROVIDERS} aria-label="Escape provider" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Escape provider" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
  },
};
