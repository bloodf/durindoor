import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import OrcaModelDropdown from "./OrcaModelDropdown";

const models = { source: "live", models: [{ id: "orca/chat-pro", name: "Orca Chat Pro", capabilities: ["chat"] }] };
const fixture = (routes) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes } });
function Controlled(props) { const [selected, setSelected] = useState(props.selectedModel || ""); return <OrcaModelDropdown {...props} selectedModel={selected} onSelect={(model) => setSelected(model.id)} onClear={() => setSelected("")} />; }
export default { title: "Production/shared-config/OrcaModelDropdown", component: OrcaModelDropdown };

export const LiveCatalog = {
  render: () => <Controlled connectionIds={["orca-1"]} />,
  parameters: fixture({ "GET /api/providers/orca-1/models?capability=chat": { body: models } }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("orca-model-trigger"));
    expect(await canvas.findByRole("option", { name: /orca chat pro/i })).toBeVisible();
  },
};

export const DegradedEmptyCatalog = {
  render: () => <Controlled connectionIds={["orca-1"]} />,
  parameters: fixture({ "GET /api/providers/orca-1/models?capability=chat": { status: 500, body: { error: "Catalog unavailable" } } }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("orca-model-trigger"));
    expect(await canvas.findByText("No OrcaRouter models match this capability or input type.")).toBeVisible();
  },
};

export const NoConnection = {
  render: () => <Controlled connectionIds={[]} />,
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(canvas.getByTestId("orca-model-trigger")); expect(canvas.getByText("Add an OrcaRouter connection first.")).toBeVisible(); },
};
