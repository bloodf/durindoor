import { useState } from "react";
import Checkbox from "./Checkbox";

function ControlledCheckbox() {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Checkbox
        checked={checked}
        label="Enable streaming"
        hint="Show response tokens as they arrive."
        onChange={setChecked}
      />
      <span className="text-xs text-dd-muted">
        Streaming is {checked ? "enabled" : "disabled"}.
      </span>
    </div>
  );
}

const meta = {
  title: "Durin DS/Forms/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
};

export default meta;

export const SoloUnchecked = {
  args: { checked: false, "aria-label": "Accept terms" },
};

export const SoloChecked = {
  args: { checked: true, "aria-label": "Accept terms" },
};

export const WithLabelAndHint = {
  args: {
    checked: false,
    label: "Send usage telemetry",
    hint: "Help improve Durin Door with anonymous diagnostics.",
  },
};

export const Error = {
  render: () => (
    <div className="flex w-80 flex-col gap-1.5">
      <Checkbox
        checked={false}
        label="I accept the connection policy"
        aria-describedby="connection-policy-error"
        aria-invalid="true"
      />
      <p id="connection-policy-error" className="text-xs text-dd-danger">
        Accept the connection policy to continue.
      </p>
    </div>
  ),
};

export const Disabled = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Checkbox checked={false} disabled label="Disabled unchecked" />
      <Checkbox checked disabled label="Disabled checked" />
    </div>
  ),
};

export const Controlled = {
  render: () => <ControlledCheckbox />,
};
