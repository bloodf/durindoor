import React from "react";
import { expect, within } from "storybook/test";

import Avatar from "./Avatar.js";

const meta = {
  title: "Production/Shared Surfaces/Avatar",
  component: Avatar,
  parameters: { layout: "centered" },
  argTypes: {
    size: { control: "radio", options: ["xs", "sm", "md", "lg", "xl"] },
    src: { control: "text" },
    name: { control: "text" },
    alt: { control: "text" },
  },
};

export default meta;

export const Playground = {
  args: { name: "Arwen Undómiel", size: "md" },
  render: (args) => (
    <div className="flex flex-col items-center gap-1">
      <Avatar {...args} />
      <span className="text-[11px] text-dd-muted">Avatar initials: AU</span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("img", { name: "Avatar" })).toHaveTextContent("AU");
  },
};

export const InitialsOnly = {
  render: () => (
    <div className="flex items-end gap-3">
      {["Aragorn II", "Legolas Thranduilion", "Gimli", "Éowyn", "Frodo Baggins"].map((name) => (
        <div key={name} className="flex flex-col items-center gap-1">
          <Avatar name={name} size="md" alt={name} />
          <span className="text-[11px] text-dd-muted">{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const Sizes = {
  render: () => (
    <div className="flex items-end gap-3">
      {["xs", "sm", "md", "lg", "xl"].map((size) => (
        <div key={size} className="flex flex-col items-center gap-1">
          <Avatar name="Durin" size={size} alt={`${size} avatar`} />
          <span className="text-[11px] text-dd-muted">{size}</span>
        </div>
      ))}
    </div>
  ),
};

export const FallbackForEmptyName = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="" size="md" />
      <span className="text-[11px] text-dd-muted">renders ? placeholder</span>
    </div>
  ),
};

export const BackgroundImageSource = {
  args: { src: "/providers/xai.svg", size: "lg", alt: "Gandalf avatar" },
  render: (args) => (
    <div className="flex flex-col items-center gap-1">
      <Avatar {...args} />
      <span className="text-[11px] text-dd-muted">Gandalf avatar</span>
    </div>
  ),
};
