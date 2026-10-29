import React from "react";
import { expect, within, waitFor } from "storybook/test";
import ComboUsageReport from "./ComboUsageReport";

export default { title: "Production/combos/Connection usage", parameters: { layout: "padded" } };
const comboFixture = (status) => ({
  scenario: "default",
  pathname: "/dashboard/combos",
  params: {},
  routes: {
    "GET /api/providers": { body: { connections: [{ id: "conn-a", name: "Primary account", provider: "openai" }] }, status: 200 },
    "GET /api/usage/combos": () => status === 200
      ? { body: { boundary: "Tracked combinations since 2024-04-01", rows: [{ comboId: "combo-1", comboName: "default-combo", connectionId: "conn-a", requests: 12, promptTokens: 1400, completionTokens: 2200, cost: 0.84 }], unattributed: { requests: 3, promptTokens: 250, completionTokens: 320, cost: 0.05 } }, status: 200 }
      : { body: { error: "internal" }, status: 500 },
  },
});

export const ComboReportLoaded = {
  render: () => <ComboUsageReport period="7d" customRange={{ startDate: "", endDate: "" }} resetNonce={1} />,
  parameters: { storyFixture: comboFixture(200) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("default-combo")).toBeVisible());
  },
};

export const ComboReportError = {
  render: () => <ComboUsageReport period="7d" customRange={{ startDate: "", endDate: "" }} resetNonce={2} />,
  parameters: { storyFixture: comboFixture(500) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible());
  },
};
