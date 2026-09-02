import { useState } from "react";

import Checkbox from "./Checkbox.jsx";
import Field from "./Field.jsx";
import Input from "./Input.jsx";
import Select from "./Select.jsx";
import Textarea from "./Textarea.jsx";

/**
 * Durin DS — Field stories (group: Forms).
 *
 * Field is the label + control + hint/error layout wrapper used by every form
 * control. Also hosts the composed "Example Form" story showing all Batch 2
 * controls together on a surface card.
 */
const meta = {
  title: "Durin DS/Forms/Field",
  component: Field,
  parameters: { layout: "centered" },
};

export default meta;

export const WithHint = {
  render: () => (
    <div className="w-72">
      <Field label="API key" hint="Stored encrypted and never shown again.">
        <Input placeholder="sk-…" />
      </Field>
    </div>
  ),
};

export const WithError = {
  render: () => (
    <div className="w-72">
      <Field label="API key" error="This key failed validation against the provider.">
        <Input defaultValue="sk-1234" />
      </Field>
    </div>
  ),
};

export const Required = {
  render: () => (
    <div className="w-72">
      <Field label="Endpoint" required hint="Base URL of the upstream provider.">
        <Input placeholder="https://api.example.com" />
      </Field>
    </div>
  ),
};

export const CheckboxGroup = {
  render: function CheckboxGroupStory() {
    const [usage, setUsage] = useState(true);
    const [errors, setErrors] = useState(false);
    return (
      <div className="w-72">
        <Field
          label="Notifications"
          hint="Choose which events reach this channel."
          className="gap-2"
        >
          <div className="flex flex-col gap-2">
            <Checkbox
              label="Usage alerts"
              checked={usage}
              onChange={setUsage}
            />
            <Checkbox
              label="Provider errors"
              checked={errors}
              onChange={setErrors}
            />
          </div>
        </Field>
      </div>
    );
  },
};

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI", hint: "GPT and o-series models", icon: "smart_toy" },
  { value: "anthropic", label: "Anthropic", hint: "Claude family", icon: "psychology" },
  { value: "gemini", label: "Google Gemini", hint: "Gemini family", icon: "diamond" },
];

/** Composed form: every Batch 2 control together on a surface card. */
export const ExampleForm = {
  parameters: { layout: "padded" },
  render: function ExampleFormStory() {
    const [name, setName] = useState("");
    const [provider, setProvider] = useState("openai");
    const [notes, setNotes] = useState("");
    const [enabled, setEnabled] = useState(true);
    return (
      <form
        className="flex w-full max-w-md flex-col gap-4 rounded-dd-lg border border-dd-border bg-dd-surface p-5"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-dd-text">Add connection</h3>
          <p className="text-xs text-dd-muted">
            Wire a new upstream provider into the router.
          </p>
        </div>
        <Input
          label="Connection name"
          hint="Shown in the dashboard and CLI."
          placeholder="e.g. Production OpenAI"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Field label="Provider" hint="Determines request translation." required>
          <Select options={PROVIDER_OPTIONS} value={provider} onChange={setProvider} />
        </Field>
        <Textarea
          label="Notes"
          hint="Optional context for teammates."
          placeholder="Rate limits, billing account, …"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <Checkbox
          label="Enable immediately"
          hint="Start routing traffic as soon as the connection is saved."
          checked={enabled}
          onChange={setEnabled}
        />
        <div className="flex items-center justify-end gap-2 border-t border-dd-border-subtle pt-4">
          <button
            type="button"
            className="h-9 rounded-dd px-3.5 text-[13px] font-medium text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-9 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus"
          >
            Save connection
          </button>
        </div>
      </form>
    );
  },
};
