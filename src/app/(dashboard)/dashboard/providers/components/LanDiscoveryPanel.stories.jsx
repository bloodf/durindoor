import React from "react";
import { expect, userEvent, within } from "storybook/test";

import LanDiscoveryPanel from "./LanDiscoveryPanel";

const candidates = [
  { baseUrl: "http://192.168.1.20:11434", host: "192.168.1.20", port: 11434, kind: "ollama", models: ["llama3", "qwen3"] },
  { baseUrl: "http://192.168.1.30:1234/v1", host: "192.168.1.30", port: 1234, kind: "openai-compatible", models: ["local-model"] },
];

const meta = {
  title: "Production/providers/components/LanDiscoveryPanel",
  component: LanDiscoveryPanel,
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: { "POST /api/providers/lan-discovery": { body: { candidates } } },
    },
  },
};

export default meta;

async function discover(canvasElement) {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText("Hosts or CIDR"), "192.168.1.0/24");
  await userEvent.click(canvas.getByRole("button", { name: "Discover" }));
  return canvas;
}

/** Idle: nothing is scanned until the operator presses Discover. */
export const Idle = {};

/** Candidates found: each lists its models and an Add action. */
export const WithCandidates = {
  play: async ({ canvasElement }) => {
    const canvas = await discover(canvasElement);
    await expect(await canvas.findByText("http://192.168.1.20:11434")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Add http://192.168.1.30:1234/v1" })).toBeInTheDocument();
  },
};

/** Nothing answered: the empty state names what was scanned for. */
export const Empty = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "POST /api/providers/lan-discovery": { body: { candidates: [] } } } },
  },
  play: async ({ canvasElement }) => {
    const canvas = await discover(canvasElement);
    await expect(await canvas.findByTestId("lan-discovery-empty")).toBeInTheDocument();
  },
};

/** Discovery is off: the panel explains how to turn it on. */
export const Disabled = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "POST /api/providers/lan-discovery": { status: 403, body: { error: "lan_discovery_disabled" } } } },
  },
  play: async ({ canvasElement }) => {
    const canvas = await discover(canvasElement);
    await expect(await canvas.findByText(/LAN discovery is turned off/)).toBeInTheDocument();
  },
};
