import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Checkbox from "./Checkbox.jsx";
import Field from "./Field.jsx";
import Input from "./Input.jsx";
import Modal from "./Modal.jsx";
import Select from "./Select.jsx";
import Textarea from "./Textarea.jsx";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
];

const MODEL_OPTIONS = [
  { value: "claude-sonnet", label: "Claude Sonnet", icon: "psychology", hint: "Balanced reasoning" },
  { value: "gpt-5", label: "GPT-5", icon: "auto_awesome", hint: "General-purpose model" },
  { value: "gemini-pro", label: "Gemini Pro", icon: "diamond", hint: "Long-context analysis" },
];

const MANY_OPTIONS = Array.from({ length: 18 }, (_, index) => ({
  value: `model-${index + 1}`,
  label: `Model ${index + 1}`,
}));


function ControlledSelect({ options = PROVIDER_OPTIONS, initialValue, ...props }) {
  const [value, setValue] = useState(initialValue);

  return <Select {...props} options={options} value={value} onChange={setValue} />;
}

function ExampleFormCard() {
  const [name, setName] = useState("Production provider");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState("anthropic");
  const [enabled, setEnabled] = useState(true);

  return (
    <form className="bg-dd-surface border border-dd-border rounded-dd-lg p-5">
      <div className="flex w-96 flex-col gap-4">
        <Input
          label="Configuration name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Field label="Provider" htmlFor="example-provider" hint="Controls request translation.">
          <Select
            id="example-provider"
            options={PROVIDER_OPTIONS}
            value={provider}
            onChange={setProvider}
          />
        </Field>
        <Textarea
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add deployment details…"
        />
        <Checkbox
          checked={enabled}
          onChange={setEnabled}
          label="Enable this provider"
          hint="It will be available for new requests."
        />
      </div>
    </form>
  );
}

const meta = {
  title: "Durin DS/Forms/Select",
  component: Select,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Default = {
  render: () => <ControlledSelect placeholder="Choose a provider" aria-label="Provider" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Provider" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(trigger).toHaveTextContent("OpenAI");
  },
};

export const WithLabelAndHint = {
  render: () => (
    <Field label="Provider" htmlFor="provider-with-hint" hint="Determines request translation.">
      <ControlledSelect id="provider-with-hint" placeholder="Choose a provider" />
    </Field>
  ),
};

export const Error = {
  render: () => (
    <Field label="Provider" htmlFor="provider-error" error="Choose a provider before continuing." required>
      <ControlledSelect id="provider-error" placeholder="Choose a provider" />
    </Field>
  ),
};

export const Disabled = {
  render: () => (
    <Select options={PROVIDER_OPTIONS} value="anthropic" disabled aria-label="Provider" />
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Provider" });
    await expect(trigger).toBeDisabled();
  },
};

export const ManyOptions = {
  render: () => (
    <ControlledSelect options={MANY_OPTIONS} initialValue="model-1" aria-label="Model" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Model" });
    await expect(trigger).toHaveTextContent("Model 1");
    await userEvent.click(trigger);
    await userEvent.keyboard("{End}");
    await expect(trigger).toHaveAttribute("aria-activedescendant", expect.stringContaining("option-17"));
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveTextContent("Model 18");
    await userEvent.click(trigger);
    await userEvent.keyboard("{End}{Escape}");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toHaveTextContent("Model 18");
  },
};

export const WithIconsAndHints = {
  render: () => (
    <ControlledSelect options={MODEL_OPTIONS} initialValue="claude-sonnet" aria-label="Model" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Model" });
    await userEvent.click(trigger);
    const listbox = await within(document.body).findByRole("listbox", { name: "Model" });
    for (const option of MODEL_OPTIONS) {
      await expect(within(listbox).getByRole("option", { name: new RegExp(option.label) })).toBeInTheDocument();
    }
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  },
};
export const PlacementTop = {
  render: () => (
    <div className="pt-72">
      <ControlledSelect placement="top" options={MODEL_OPTIONS} aria-label="Model" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Model" });
    await userEvent.click(trigger);
    const listbox = await within(document.body).findByRole("listbox", { name: "Model" });
    for (const option of MODEL_OPTIONS) {
      await expect(within(listbox).getByRole("option", { name: new RegExp(option.label) })).toBeInTheDocument();
    }
  },
};


export const Empty = {
  render: () => <Select options={[]} aria-label="Empty provider" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Empty provider" });
    await userEvent.click(trigger);
    await expect(within(document.body).getByText("No options")).toBeInTheDocument();
  },
};

export const InsideModal = {
  render: () => <Modal open onClose={() => {}} title="Provider settings"><ControlledSelect options={MODEL_OPTIONS} aria-label="Modal model" /></Modal>,
  play: async ({ canvasElement }) => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Provider settings" });
    const trigger = within(dialog).getByRole("combobox", { name: "Modal model" });
    await userEvent.click(trigger);
    await expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
  },
};

export const ExampleForm = {
  render: () => <ExampleFormCard />,
};
