import React from "react";
import { expect, within } from "storybook/test";

import Badge from "./Badge.js";

const meta = {
  title: "Production/Shared Surfaces/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "primary", "success", "warning", "error", "info"],
    },
    size: { control: "radio", options: ["sm", "md", "lg"] },
    dot: { control: "boolean" },
    icon: { control: "text" },
  },
};

export default meta;

export const Playground = {
  args: { variant: "default", size: "md", children: "Badge" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Badge")).toBeInTheDocument();
  },
};

export const AllVariants = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">Default</Badge>
        <Badge variant="primary">Primary</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="error">Error</Badge>
        <Badge variant="info">Info</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default" dot>Default</Badge>
        <Badge variant="primary" dot>Primary</Badge>
        <Badge variant="success" dot>Success</Badge>
        <Badge variant="warning" dot>Warning</Badge>
        <Badge variant="error" dot>Error</Badge>
        <Badge variant="info" dot>Info</Badge>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Success")).toHaveLength(2);
    await expect(canvas.getAllByText("Error")).toHaveLength(2);
  },
};

export const Sizes = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="sm">sm</Badge>
      <Badge size="md">md</Badge>
      <Badge size="lg">lg</Badge>
      <Badge size="sm" icon="check_circle">sm + icon</Badge>
      <Badge size="md" icon="warning">md + icon</Badge>
      <Badge size="lg" icon="error">lg + icon</Badge>
    </div>
  ),
};

export const WithDotAndIcon = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="success" icon="check_circle" dot>Healthy</Badge>
      <Badge variant="warning" icon="warning" dot>Degraded</Badge>
      <Badge variant="error" icon="error" dot>Offline</Badge>
      <Badge variant="info" icon="info" dot>Beta</Badge>
      <Badge variant="primary" icon="bolt" dot>Featured</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("check_circle")).toBeInTheDocument();
    await expect(canvas.getByText("Healthy")).toBeInTheDocument();
  },
};

export const StatusInList = {
  render: () => (
    <ul className="flex w-96 flex-col gap-1">
      {[
        { name: "openai/gpt-5", tone: "success", icon: "check_circle", label: "Healthy" },
        { name: "anthropic/claude-sonnet-4.5", tone: "warning", icon: "warning", label: "Rate limited" },
        { name: "gemini/gemini-3-pro", tone: "info", icon: "science", label: "Beta" },
        { name: "local/llama-4-scout", tone: "default", icon: "smart_toy", label: "Idle" },
      ].map((row) => (
        <li
          key={row.name}
          className="flex items-center justify-between rounded-dd border border-dd-border bg-dd-surface px-3 py-2"
        >
          <span className="font-mono text-[13px] text-dd-text">{row.name}</span>
          <Badge variant={row.tone} icon={row.icon} size="sm" dot>
            {row.label}
          </Badge>
        </li>
      ))}
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("anthropic/claude-sonnet-4.5")).toBeInTheDocument();
    await expect(canvas.getByText("Rate limited")).toBeInTheDocument();
  },
};
