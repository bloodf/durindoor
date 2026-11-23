import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import CopilotM365AuthModal from "./CopilotM365AuthModal";

function CopilotM365Story(props) {
  const [open, setOpen] = useState(true);
  return <CopilotM365AuthModal {...props} isOpen={open} onClose={() => setOpen(false)} />;
}

const NATIVE = "https://login.microsoftonline.com/common/oauth2/nativeclient";

const meta = {
  title: "Production/shared-oauth/CopilotM365AuthModal",
  component: CopilotM365AuthModal,
  parameters: {
    layout: "centered",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/copilot-m365-web",
      params: { id: "copilot-m365-web" },
      routes: {
        "POST /api/oauth/copilot-m365-web/authorize": {
          body: { authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=demo-state", state: "demo-state", flowId: "demo-flow", expiresAt: "2099-01-01T00:00:00.000Z" },
          status: 200,
        },
        "POST /api/oauth/copilot-m365-web/exchange": { body: { success: true }, status: 200 },
      },
    },
  },
};

export default meta;

export const Intro = {
  render: () => <CopilotM365Story providerInfo={{ name: "Microsoft 365 Copilot Web" }} />,
};

export const SignInStarted = {
  render: () => <CopilotM365Story providerInfo={{ name: "Microsoft 365 Copilot Web" }} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Sign in to Microsoft 365 Copilot Web" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Start sign-in/i }));
    await waitFor(() => expect(within(dialog).getByLabelText("Callback URL")).toBeInTheDocument());
    await expect(within(dialog).getByRole("link", { name: "Microsoft sign-in page" })).toHaveAttribute("href", expect.stringContaining("state=demo-state"));
  },
};

export const ExchangeRejected = {
  render: () => <CopilotM365Story providerInfo={{ name: "Microsoft 365 Copilot Web" }} />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/copilot-m365-web",
      params: { id: "copilot-m365-web" },
      routes: {
        "POST /api/oauth/copilot-m365-web/authorize": {
          body: { authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=demo-state", state: "demo-state", flowId: "demo-flow" },
          status: 200,
        },
        "POST /api/oauth/copilot-m365-web/exchange": { body: { error: "M365 redirected URL is invalid" }, status: 400 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Sign in to Microsoft 365 Copilot Web" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Start sign-in/i }));
    await userEvent.type(await within(dialog).findByLabelText("Callback URL"), `${NATIVE}?code=demo&state=demo-state`);
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(within(dialog).getByText("M365 redirected URL is invalid")).toBeInTheDocument());
  },
};
