import React, { useState } from "react";
import { within, userEvent, expect } from "storybook/test";
import MitmModelMappingRow from "./MitmModelMappingRow";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
export default {
  title: "Durin DS/Production Pages/cli-tools/MitmModelMappingRow",
  component: MitmModelMappingRow,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/antigravity" } },
};

function Controlled(props) {
  const [entry, setEntry] = useState(props.entry || {});
  return <MitmModelMappingRow
    {...props}
    entry={entry}
    onModelChange={(value) => setEntry((prev) => ({ ...prev, model: value }))}
    onModelBlur={() => {}}
    onModelClear={() => setEntry((prev) => ({ ...prev, model: "" }))}
    onModelSelect={() => {}}
    onReasoningChange={(value) => setEntry((prev) => ({ ...prev, reasoningEffort: value }))}
  />;
}

const antigravityTool = MITM_TOOLS.antigravity;
const model = antigravityTool.defaultModels[0];

export const Empty = {
  render: (args) => <Controlled {...args} />,
  args: { model, canSelectModel: true },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText(model.name)).toBeInTheDocument();
  },
};
export const WithModel = {
  render: (args) => <Controlled {...args} />,
  args: { model, canSelectModel: true, entry: { model: "openai/gpt-4.1" } },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByDisplayValue("openai/gpt-4.1")).toBeInTheDocument();
  },
};
export const AntigravityReasoning = {
  render: (args) => <Controlled {...args} />,
  args: { model, canSelectModel: true, showReasoning: true, entry: { model: "openai/gpt-4.1", reasoningEffort: "medium" } },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("combobox", { name: /reasoning/i })).toBeInTheDocument();
  },
};
export const Disabled = { render: (args) => <Controlled {...args} />, args: { model, canSelectModel: true, disabled: true } };
export const ClearModel = {
  render: (args) => <Controlled {...args} />,
  args: { model, canSelectModel: true, entry: { model: "openai/gpt-4.1" } },
  play: async ({ canvasElement }) => {
    const clear = within(canvasElement).getByRole("button", { name: /clear model mapping/i });
    await userEvent.click(clear);
    expect(within(canvasElement).getByPlaceholderText(/provider\/model-id/i)).toHaveValue("");
  },
};
