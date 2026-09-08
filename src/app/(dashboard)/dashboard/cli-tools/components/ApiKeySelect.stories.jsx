import React, { useState } from "react";
import { within, userEvent, expect } from "storybook/test";
import ApiKeySelect from "./ApiKeySelect";

export default {
  title: "Durin DS/Production Pages/cli-tools/ApiKeySelect",
  component: ApiKeySelect,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/claude" } },
};

function Controlled(props) {
  const [value, setValue] = useState(props.value || "");
  return <ApiKeySelect {...props} value={value} onChange={setValue} />;
}

export const Empty = { render: (args) => <Controlled {...args} /> };
export const WithManagedKeys = {
  render: (args) => <Controlled {...args} />,
  args: { apiKeys: [{ name: "Primary", maskedKey: "sk_••••1234" }] },
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/Managed keys/i)).toBeInTheDocument();
  },
};
export const CloudEnabled = {
  render: (args) => <Controlled {...args} />,
  args: { cloudEnabled: true },
  play: ({ canvasElement }) => {
    const input = within(canvasElement).getByPlaceholderText(/paste the api key secret/i);
    expect(input).toBeInTheDocument();
  },
};
export const TypeInput = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByPlaceholderText(/sk_durindoor/i);
    await userEvent.type(input, "sk_test_1234");
    expect(input).toHaveValue("sk_test_1234");
  },
};
