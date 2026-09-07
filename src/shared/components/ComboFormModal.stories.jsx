import React, { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import ComboFormModal from "./ComboFormModal";

function ComboHarness({ combo = null, forcePrefix = "" }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(null);
  const handleSave = fn(async (value) => setSaved(value));
  return (
    <>
      <ComboFormModal
        isOpen={open}
        combo={combo}
        forcePrefix={forcePrefix}
        activeProviders={[]}
        onClose={() => setOpen(false)}
        onSave={handleSave}
      />
      <output data-testid="result" className="sr-only">{saved ? JSON.stringify(saved) : "open"}</output>
    </>
  );
}

const meta = {
  title: "Production/shared-domain/ComboFormModal",
  component: ComboFormModal,
  parameters: {
    layout: "centered",
    storyFixture: { scenario: "default", pathname: "/dashboard/combos", params: {}, routes: { "GET /api/models/alias": { body: { aliases: { "openai/gpt-5": "GPT-5" } }, status: 200 } } },
  },
};
export default meta;

export const Create = { render: () => <ComboHarness /> };

export const EditWithPriorityAndCapabilities = {
  render: () => (
    <ComboHarness
      forcePrefix="claude-"
      combo={{ name: "claude-reliable", models: ["openai/gpt-5", "anthropic/claude-sonnet"], capabilities: { vision: false, contextWindow: 128000 } }}
    />
  ),
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const dialog = await within(body).findByRole("dialog", { name: "Edit Combo" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Move anthropic/claude-sonnet up" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await expect(within(body).getByTestId("result").textContent).toMatch(/"name":"claude-reliable"/);
  },
};

export const AliasFetchError = {
  render: () => <ComboHarness combo={{ name: "claude-x", models: ["anthropic/claude-sonnet"], capabilities: {} }} forcePrefix="claude-" />,
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/combos", params: {}, routes: { "GET /api/models/alias": { body: { error: "registry offline" }, status: 503 } } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    // Modal still renders fully; alias fetch is best-effort so no UI error, but a successful save still works.
    const dialog = await canvas.findByRole("dialog", { name: "Edit Combo" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await expect(canvas.getByTestId("result").textContent).toMatch(/"name":"claude-x"/);
  },
};
