import React from "react";
import { within, userEvent, expect } from "storybook/test";
import MitmToolCard from "./MitmToolCard";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
export default {
  title: "Durin DS/Production Pages/cli-tools/MitmToolCard",
  component: MitmToolCard,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools" } },
};

const tool = MITM_TOOLS.antigravity;
const baseArgs = { tool, isExpanded: true, onToggle: () => {}, serverRunning: true, dnsActive: false, hasCachedPassword: true, needsSudoPassword: false, isWin: false, apiKeys: [], activeProviders: [], hasActiveProviders: true, modelAliases: {} };
const routes = {
  "GET /api/cli-tools/antigravity-mitm/alias": { body: { aliases: { [tool.defaultModels[0].alias]: { model: "openai/gpt-4.1", reasoningEffort: "medium" } } } },
  "PUT /api/cli-tools/antigravity-mitm/alias": { body: { ok: true } },
  "PATCH /api/cli-tools/antigravity-mitm": { body: { dnsConfigured: true } },
};

export const Collapsed = {
  args: { ...baseArgs, isExpanded: false },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("button", { name: /antigravity/i })).toBeInTheDocument();
  },
};
export const DnsOff = {
  args: baseArgs,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", routes } },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("combobox", { name: `Reasoning effort for ${tool.defaultModels[0].name}` })).toBeInTheDocument();
    expect(within(canvasElement).getByRole("button", { name: /start dns/i })).toBeInTheDocument();
  },
};
export const DnsActive = {
  args: { ...baseArgs, dnsActive: true },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", routes } },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("button", { name: /stop dns/i })).toBeInTheDocument();
  },
};
export const SudoPrompted = {
  args: { ...baseArgs, needsSudoPassword: true, hasCachedPassword: false, isWin: false },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", routes } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /start dns/i }));
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("dialog", { name: /sudo password required/i })).toBeInTheDocument();
  },
};
