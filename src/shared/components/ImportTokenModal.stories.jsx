import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import ImportTokenModal from "./ImportTokenModal";

function ImportTokenStory(props) {
  const [open, setOpen] = useState(true);
  return <ImportTokenModal {...props} isOpen={open} onClose={() => setOpen(false)} />;
}

const meta = {
  title: "Production/shared-oauth/ImportTokenModal",
  component: ImportTokenModal,
  parameters: {
    layout: "centered",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/github/import-token": { body: { ok: true }, status: 200 },
      },
    },
  },
};

export default meta;

export const Default = {
  render: () => <ImportTokenStory provider="github" providerInfo={{ name: "GitHub" }} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitHub" });
    expect(within(dialog).getByLabelText("Access token")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  },
};

export const ImportFailure = {
  render: () => <ImportTokenStory provider="github" providerInfo={{ name: "GitHub" }} />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/github/import-token": { body: { error: "Token was rejected" }, status: 401 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitHub" });
    await userEvent.type(within(dialog).getByLabelText("Access token"), "invalid-token");
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Token was rejected");
  },
};
