import React, { useState } from "react";
import { within, userEvent, expect } from "storybook/test";
import ApiKeySelect from "./ApiKeySelect";

export default {
  title: "Durin DS/Production Pages/cli-tools/ApiKeySelect",
  component: ApiKeySelect,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/claude" } },
  beforeEach: () => {
    const key = "durindoor.cliToolApiKeyPresets";
    const previous = localStorage.getItem(key);
    localStorage.removeItem(key);
    return () => {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    };
  },
};

function Controlled(props) {
  const [value, setValue] = useState(props.value || "");
  return <ApiKeySelect {...props} value={value} onChange={setValue} />;
}

export const Empty = {
  render: (args) => <Controlled {...args} />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByLabelText("API key")).toBeVisible();
    expect(canvas.getByText("API key", { exact: true })).toBeVisible();
  },
};
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
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("API key");
    expect(input).toBeVisible();
    expect(input).toHaveAttribute("placeholder", "Paste the API key secret");
    expect(canvas.getByText("API key", { exact: true })).toBeVisible();
  },
};
export const TypeInput = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("API key");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "sk_test_1234");
    await expect(input).toHaveValue("sk_test_1234");
    await expect(canvas.getByText("API key", { exact: true })).toBeVisible();
  },
};
