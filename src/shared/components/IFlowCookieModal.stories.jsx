import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import IFlowCookieModal from "./IFlowCookieModal";

function IFlowStory(props) {
  const [open, setOpen] = useState(true);
  return <IFlowCookieModal {...props} isOpen={open} onClose={() => setOpen(false)} />;
}

const meta = {
  title: "Production/shared-oauth/IFlowCookieModal",
  component: IFlowCookieModal,
  parameters: {
    layout: "centered",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/iflow/cookie": { body: { ok: true, apiKey: "fresh-key" }, status: 200 },
      },
    },
  },
};

export default meta;

export const Default = { render: () => <IFlowStory /> };

export const ServerError = {
  render: () => <IFlowStory />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/iflow/cookie": { body: { error: "Cookie is expired" }, status: 400 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "iFlow Cookie Authentication" });
    await userEvent.type(within(dialog).getByLabelText("Cookie string"), "BXAuth=stale");
    await userEvent.click(within(dialog).getByRole("button", { name: "Authenticate" }));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Cookie is expired");
  },
};

export const EmptySubmit = {
  render: () => <IFlowStory />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "iFlow Cookie Authentication" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Authenticate" }));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Please paste your cookie");
  },
};
