import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { KeyLimitsModal, KeyUsageSummary } from "./ApiKeyLimits";

const apiKey = {
  id: "story-key",
  name: "Build harness",
  dailyLimitTokens: 100000,
  policy: { rpmLimit: 60, monthlyBudget: 25 },
};

const meta = {
  title: "Production/endpoint/ApiKeyLimits",
  component: KeyLimitsModal,
  parameters: { layout: "padded" },
};

export default meta;

export const UsageSummary = {
  render: () => <KeyUsageSummary usage={{ rpm: { used: 12, limit: 60 }, tpm: { used: 800, limit: 1000 }, limits: [{ field: "dailyLimitTokens", label: "Daily tokens", used: 100000, limit: 100000, always: true }, { field: "monthlyBudget", label: "Monthly cost", used: 24, limit: 25, money: true }] }} />,
};

export const EditLimits = {
  args: { apiKey, onClose: () => {}, onSave: async () => {} },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await expect(await dialog.findByRole("dialog", { name: "Limits for Build harness" })).toBeVisible();
    await expect(dialog.getByRole("spinbutton", { name: "Requests / minute" })).toHaveValue(60);
    await expect(dialog.getByRole("spinbutton", { name: "Budget (USD)" })).toHaveValue(25);
  },
};

export const InvalidLimitBlocksSave = {
  render: (args) => {
    function Wrapper() {
      const [saved, setSaved] = useState(false);
      return <><KeyLimitsModal {...args} onSave={async () => setSaved(true)} />{saved ? <p>Saved</p> : null}</>;
    }
    return <Wrapper />;
  },
  args: { apiKey, onClose: () => {} },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    const rate = await dialog.findByRole("spinbutton", { name: "Requests / minute" });
    await userEvent.clear(rate);
    await userEvent.type(rate, "-1");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};
