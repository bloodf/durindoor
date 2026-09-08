import React from "react";
import { within, expect } from "storybook/test";
import ToolSummaryCard from "./ToolSummaryCard";

export default {
  title: "Durin DS/Production Pages/cli-tools/ToolSummaryCard",
  component: ToolSummaryCard,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools" } },
};

const tool = { name: "Claude Code", icon: "terminal" };

function assertStatus(link, expected) {
  const linkScope = within(link);
  expect(linkScope.getByText(expected)).toBeInTheDocument();
  expect(linkScope.getByRole("heading", { name: tool.name })).toBeInTheDocument();
}

export const Connected = {
  args: { toolId: "claude", tool, status: { installed: true, has9Router: true } },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    assertStatus(link, "Connected");
  },
};
export const NotConfigured = {
  args: { toolId: "claude", tool, status: { installed: true, has9Router: false } },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    assertStatus(link, "Not configured");
  },
};
export const NotInstalled = {
  args: { toolId: "claude", tool, status: { installed: false } },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    assertStatus(link, "Not installed");
  },
};
export const Unknown = {
  args: { toolId: "claude", tool, status: null },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    assertStatus(link, "Unknown");
  },
};
export const Unsupported = {
  args: { toolId: "amp", tool: { ...tool, unsupported: true }, status: null },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    assertStatus(link, "Unsupported");
  },
};
