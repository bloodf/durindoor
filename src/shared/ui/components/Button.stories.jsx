import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Button from "./Button";

/**
 * Button covers primary, secondary, ghost, and destructive danger actions.
 * Every variant stays 44px square or larger while label text remains dense.
 * Backgrounds come from the "Theme" toolbar — stories never set their own.
 */
const meta = {
  title: "Durin DS/Actions/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: { control: "inline-radio", options: ["sm", "md"] },
    icon: { control: "text" },
    iconTrailing: { control: "text" },
  },
  args: {
    children: "Save changes",
  },
};

export default meta;

export const Primary = {
  args: { variant: "primary", children: "Create connection" },
};

export const Secondary = {};

export const Ghost = {
  args: { variant: "ghost" },
};

export const Danger = {
  args: { variant: "danger", icon: "delete", children: "Delete connection" },
};

export const WithLeadingIcon = {
  args: { variant: "primary", icon: "add", children: "New model" },
};

export const WithTrailingIcon = {
  args: {
    variant: "secondary",
    iconTrailing: "arrow_drop_down",
    children: "More actions",
  },
};


export const LongLabelWithIcon = {
  args: {
    variant: "secondary",
    icon: "vpn_key",
    children: "Generate a replacement production access key",
  },
};
export const Small = {
  args: { size: "sm", variant: "secondary", icon: "edit", children: "Rename" },
};

export const Loading = {
  args: { variant: "primary", loading: true, children: "Saving…" },
};

function KeyboardDemo() {
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="primary" onClick={() => setSaved(true)}>
        Save keyboard changes
      </Button>
      <output aria-live="polite">{saved ? "Saved" : "Unsaved"}</output>
    </div>
  );
}

export const KeyboardActivation = {
  render: () => <KeyboardDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Save keyboard changes" });

    button.focus();
    await expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText("Saved")).toBeInTheDocument();
  },
};

export const Disabled = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="primary" disabled>
        Primary
      </Button>
      <Button variant="secondary" disabled>
        Secondary
      </Button>
      <Button variant="ghost" disabled>
        Ghost
      </Button>
      <Button variant="danger" disabled>
        Danger
      </Button>
    </div>
  ),
};

const MATRIX_VARIANTS = ["primary", "secondary", "ghost", "danger"];

/** All four variants across both densities plus loading and disabled. */
export const VariantMatrix = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex flex-col gap-4">
      {MATRIX_VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          <span className="w-20 text-xs text-dd-muted">{variant}</span>
          <Button variant={variant}>Default</Button>
          <Button variant={variant} size="sm">
            Small
          </Button>
          <Button variant={variant} loading>
            Loading
          </Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};
