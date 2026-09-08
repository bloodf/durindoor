import React, { useState } from "react";
import { within, userEvent, expect } from "storybook/test";
import EndpointPresetControl from "./EndpointPresetControl";
import { isBrowser } from "@/shared/utils/typeChecks";

const STORAGE_KEY = "durindoor.cliToolEndpointPresets";

export default {
  title: "Durin DS/Production Pages/cli-tools/EndpointPresetControl",
  component: EndpointPresetControl,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/claude" } },
};

function Controlled(props) {
  const [baseUrl, setBaseUrl] = useState(props.baseUrl || "https://api.example.com/v1");
  const [apiKey, setApiKey] = useState(props.apiKey || "sk_test_1234");
  return <EndpointPresetControl {...props} baseUrl={baseUrl} apiKey={apiKey} onBaseUrlChange={setBaseUrl} onApiKeyChange={setApiKey} />;
}

function withSeededPreset(Story) {
  function Wrapper() {
    useState(() => {
      if (isBrowser()) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ name: "Prod", baseUrl: "https://api.example.com/v1", apiKey: "sk_1234" }]));
      }
      return true;
    });
    React.useEffect(() => () => {
      if (isBrowser()) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }, []);
    return <Story />;
  }
  return <Wrapper />;
}

export const NoPresets = { render: (args) => <Controlled {...args} /> };

export const WithPresets = {
  render: (args) => <Controlled {...args} />,
  decorators: [withSeededPreset],
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox");
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("option", { name: /Prod/i })).toBeInTheDocument();
  },
};

export const OpenSaveDialog = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvasElement }) => {
    const saveBtn = within(canvasElement).getByRole("button", { name: /^save$/i });
    await userEvent.click(saveBtn);
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("dialog", { name: /save preset/i })).toBeInTheDocument();
  },
};
