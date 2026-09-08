import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import GitLabAuthModal from "./GitLabAuthModal";

function GitLabStory(props) {
  const [open, setOpen] = useState(true);
  return <GitLabAuthModal {...props} isOpen={open} onClose={() => setOpen(false)} />;
}

const meta = {
  title: "Production/shared-oauth/GitLabAuthModal",
  component: GitLabAuthModal,
  parameters: {
    layout: "centered",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/gitlab/pat": { body: { ok: true }, status: 200 },
        "POST /api/oauth/gitlab/authorize": {
          body: { authUrl: "https://gitlab.com/oauth/authorize?client_id=demo&state=demo-state", flowId: "demo-flow", state: "demo-state" },
          status: 200,
        },
        "POST /api/oauth/gitlab/start-proxy": { body: { success: true, serverSide: true }, status: 200 },
        "POST /api/oauth/gitlab/poll-status": { body: { status: "pending" }, status: 200 },
      },
    },
  },
};

export default meta;

export const ModeSelection = {
  render: () => <GitLabStory providerInfo={{ name: "GitLab Duo" }} />,
};

export const OAuthConfiguration = {
  render: () => <GitLabStory providerInfo={{ name: "GitLab Duo" }} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitLab Duo" });
    await userEvent.click(within(dialog).getByRole("button", { name: /^OAuth app/i }));
    await waitFor(() => expect(within(dialog).getByLabelText("GitLab base URL")).toBeInTheDocument());
    await expect(within(dialog).getByLabelText("Client ID")).toBeInTheDocument();
    await expect(within(dialog).getByLabelText("Client secret (optional for PKCE)")).toBeInTheDocument();
  },
};

export const PatSubmit = {
  render: () => <GitLabStory providerInfo={{ name: "GitLab Duo" }} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitLab Duo" });
    await userEvent.click(within(dialog).getByRole("button", { name: /^Personal access token/i }));
    await userEvent.type(await within(dialog).findByLabelText("Personal access token"), "glpat-demo");
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
  },
};

export const PatFailure = {
  render: () => <GitLabStory providerInfo={{ name: "GitLab Duo" }} />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      params: {},
      routes: {
        "POST /api/oauth/gitlab/pat": { body: { error: "Token rejected by GitLab" }, status: 403 },
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitLab Duo" });
    await userEvent.click(within(dialog).getByRole("button", { name: /^Personal access token/i }));
    await userEvent.type(await within(dialog).findByLabelText("Personal access token"), "glpat-bad");
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Token rejected by GitLab");
  },
};

export const EmptyPatBlocksSubmit = {
  render: () => <GitLabStory providerInfo={{ name: "GitLab Duo" }} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Connect GitLab Duo" });
    await userEvent.click(within(dialog).getByRole("button", { name: /^Personal access token/i }));
    const connect = await within(dialog).findByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
  },
};
