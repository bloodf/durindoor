import React from "react";

globalThis.React ??= React;

import { expect, userEvent, within } from "storybook/test";

import ComboAllowListEditor from "./ComboAllowListEditor.jsx";

const connections = [
  { id: "conn-openai-1", name: "OpenAI prod", provider: "openai" },
  { id: "conn-anthropic-1", name: "Anthropic team", provider: "anthropic" },
  { id: "conn-google-1", name: "Google pool", provider: "google" },
];

const groups = [
  { id: "grp-prod", name: "Production", connectionIds: ["conn-openai-1", "conn-anthropic-1"] },
];

const meta = {
  title: "Production/Combos/ComboAllowListEditor",
  component: ComboAllowListEditor,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ minWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Unrestricted = {
  args: {
    allowedConnectionIds: [],
    connections,
    groups,
    onChange: async () => {},
  },
  play: async () => {
    const canvas = within(document.body);
    await expect(
      canvas.getByText("Unrestricted — allow any eligible connection")
    ).toBeInTheDocument();
  },
};

export const Populated = {
  args: {
    allowedConnectionIds: ["conn-openai-1", "conn-anthropic-1"],
    connections,
    groups,
    onChange: async (next) => {
      window.__lastAllowList = next;
    },
  },
  play: async () => {
    const canvas = within(document.body);
    await expect(await canvas.findByRole("button", { name: /Remove OpenAI prod/ })).toBeVisible();
    await expect(await canvas.findByRole("button", { name: /Remove Anthropic team/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Clear \(unrestrict\)/ }));
    await expect(window.__lastAllowList).toEqual([]);
  },
};

export const WithGroupQuickAdd = {
  args: {
    allowedConnectionIds: ["conn-openai-1"],
    connections,
    groups,
    onChange: async (next) => {
      window.__lastAllowList = next;
    },
  },
  beforeEach: () => {
    window.__lastAllowList = null;
    return () => {
      window.__lastAllowList = null;
    };
  },
  play: async () => {
    const canvas = within(document.body);
    await expect(await canvas.findByRole("button", { name: /Remove OpenAI prod/ })).toBeVisible();
    const groupCombobox = await canvas.findByRole("combobox", { name: "Add a group…" });
    await userEvent.click(groupCombobox);
    const productionOption = await canvas.findByRole("option", { name: /Production \(\+1\)/ });
    await userEvent.click(productionOption);
    await expect(window.__lastAllowList).toEqual(["conn-openai-1", "conn-anthropic-1"]);
  },
};

function AllowListRetryHarness() {
  const [ids, setIds] = React.useState(["conn-openai-1"]);
  const attempts = React.useRef(0);
  return <ComboAllowListEditor connections={connections} groups={groups} allowedConnectionIds={ids} onChange={async (next) => {
    if (++attempts.current === 1) return { ok: false, error: "Connection restriction rejected" };
    setIds(next); return { ok: true };
  }} />;
}
export const RejectedClearAndRetry = {
  render: () => <AllowListRetryHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Clear/ }));
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("restriction rejected");
    await expect(canvas.getByRole("button", { name: /Remove OpenAI/ })).toBeVisible();
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await expect(canvas.queryByRole("button", { name: /Remove OpenAI/ })).not.toBeInTheDocument();
  },
};
