import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import SkillsPage from "./page";

export default { title: "Production/operations/SkillsPage", component: SkillsPage, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/skills" } } };
export const Default = {};
export const CopyEntryLink = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await canvas.findByText("Skills"); await expect(canvas.getAllByRole("button", { name: /Copy link|Copy instruction/i }).length).toBeGreaterThan(0); await userEvent.click(canvas.getAllByRole("button", { name: /Copy link/i })[0]); await expect(canvas.getAllByRole("button", { name: /Copied/i }).length).toBeGreaterThan(0); } };


export const CopyInstructionFailure = {
  parameters: {
    storyFixture: {
      scenario: "error",
      pathname: "/dashboard/skills",
      routes: {
        "GET /api/keys": { body: { keys: [{ id: "key-1", name: "Fixture key", maskedKey: "sk-••••" }] } },
        "GET /api/keys/key-1/reveal": { status: 403, body: { error: "Forbidden" } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const keyPicker = await canvas.findByRole("combobox", { name: "API key" });
    await waitFor(() => expect(keyPicker).toBeEnabled());
    await userEvent.click(keyPicker);
    await userEvent.click(await within(document.body).findByRole("option", { name: /Fixture key/ }));
    await userEvent.click(canvas.getAllByRole("button", { name: "Copy for agent" })[0]);
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Could not read that key. Pick another.");
  },
};
export const ManyEndpoints = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/skills",
      routes: {
        "GET /api/tunnel/status": {
          body: {
            tunnel: {
              enabled: true,
              tunnelUrl: "https://tunnel.fixture.test",
              allUrls: ["https://tunnel.fixture.test", "https://tunnel-alt.fixture.test"],
              externalTunnel: { tunnelUrl: "https://external.fixture.test" },
            },
            tailscale: {
              enabled: true,
              tunnelUrl: "https://host.tailnet.fixture.test",
              systemTailscale: { tunnelUrl: "https://system.tailnet.fixture.test" },
            },
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("combobox", { name: /Endpoint/i });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const listbox = await within(document.body).findByRole("listbox", { name: /Endpoint/i });
    await expect(within(listbox).getAllByRole("option").length).toBeGreaterThanOrEqual(6);
    await expect(within(listbox).getByText(/External Tailscale — https:\/\/system\.tailnet\.fixture\.test\/v1/)).toBeVisible();
  },
};
