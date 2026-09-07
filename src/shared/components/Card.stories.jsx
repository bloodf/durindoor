import React from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import Badge from "./Badge.js";
import Card from "./Card.js";

const meta = {
  title: "Production/Shared Surfaces/Card",
  component: Card,
  parameters: { layout: "centered" },
  argTypes: {
    padding: { control: "radio", options: ["none", "xs", "sm", "md", "lg"] },
    hover: { control: "boolean" },
    elev: { control: "boolean" },
  },
};

export default meta;

export const Playground = {
  args: { padding: "md", hover: false, elev: false, children: "Body content" },
  render: (args) => (
    <Card {...args} className="w-80">
      A bordered surface with default padding and no elevation.
    </Card>
  ),
};

export const TitledWithIcon = {
  render: () => (
    <Card
      className="w-96"
      title="Combos"
      subtitle="Model combos with fallback"
      icon="layers"
      action={<Badge variant="primary" size="sm">12</Badge>}
    >
      <p className="text-[13px] text-dd-muted">Composed header using an emerald icon tile and right-aligned badge.</p>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Combos")).toBeInTheDocument();
    await expect(canvas.getByText("layers")).toBeInTheDocument();
  },
};

export const PaddingScale = {
  render: () => (
    <div className="flex flex-col gap-4">
      {[
        { padding: "none", label: "none" },
        { padding: "xs", label: "xs" },
        { padding: "sm", label: "sm" },
        { padding: "md", label: "md (default)" },
        { padding: "lg", label: "lg" },
      ].map(({ padding, label }) => (
        <Card key={padding} padding={padding} className="w-80">
          <span className="text-[13px] text-dd-muted">padding = {label}</span>
        </Card>
      ))}
    </div>
  ),
};

export const ElevatedAndHoverable = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Card className="w-80" elev title="Elevated" subtitle="shadow-dd-elevated">
        <p className="text-[13px] text-dd-muted">Reserved for popovers and lifted surfaces.</p>
      </Card>
      <Card className="w-80" hover title="Hoverable" subtitle="border tinted to accent on hover/focus-within">
        <p className="text-[13px] text-dd-muted">Used for clickable and linked cards.</p>
      </Card>
    </div>
  ),
};

export const SubComponents = {
  args: { onRemove: fn() },
  render: ({ onRemove }) => (
    <Card padding="none" className="w-96">
      <Card.Section>
        <h4 className="text-sm font-semibold text-dd-text">Card.Section</h4>
        <p className="text-xs text-dd-muted">Bordered inset for grouped content.</p>
      </Card.Section>
      <ul className="px-3">
        {["Sauron", "Saruman", "Witch-king"].map((name, idx) => (
          <Card.Row key={name}>
            <div className="flex items-center justify-between">
              <span className="text-dd-text">{name}</span>
              {idx === 0 && <Badge variant="error" size="sm" icon="error">Hot</Badge>}
            </div>
          </Card.Row>
        ))}
        <Card.ListItem
          actions={
            <button
              onClick={onRemove}
              className="flex min-h-[44px] items-center rounded-dd border border-dd-border bg-dd-surface-2 px-2 py-1 text-[11px] text-dd-muted outline-none hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
            >
              Remove
            </button>
          }
        >
          <span className="text-dd-text">Mouth of Sauron (hover/focus reveals action on sm+; always visible on touch)</span>
        </Card.ListItem>
      </ul>
    </Card>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const removeButton = canvas.getByRole("button", { name: "Remove" });
    await userEvent.click(removeButton);
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};
