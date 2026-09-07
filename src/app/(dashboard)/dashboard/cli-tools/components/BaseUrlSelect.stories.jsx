import React, { useState } from "react";
import { within, userEvent, expect } from "storybook/test";
import BaseUrlSelect from "./BaseUrlSelect";

export default {
  title: "Durin DS/Production Pages/cli-tools/BaseUrlSelect",
  component: BaseUrlSelect,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/claude" } },
};

function Controlled(props) {
  const [value, setValue] = useState(props.value || "http://127.0.0.1:20128/v1");
  return <BaseUrlSelect {...props} value={value} onChange={setValue} />;
}

export const Local = {
  render: (args) => <Controlled {...args} />,
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("combobox", { name: /endpoint/i })).toBeInTheDocument();
  },
};
export const Tunnel = { render: (args) => <Controlled {...args} />, args: { tunnelEnabled: true, tunnelPublicUrl: "https://tunnel.example.com" } };
export const Cloud = { render: (args) => <Controlled {...args} />, args: { cloudEnabled: true, cloudUrl: "https://cloud.example.com" } };
export const SwitchToCustom = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvasElement }) => {
    const trigger = await within(canvasElement).findByRole("combobox", { name: /endpoint/i });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const custom = await body.findByRole("option", { name: /custom url/i });
    await userEvent.click(custom);
    expect(await within(canvasElement).findByPlaceholderText(/https:\/\/example.com\/v1/i)).toBeInTheDocument();
  },
};
