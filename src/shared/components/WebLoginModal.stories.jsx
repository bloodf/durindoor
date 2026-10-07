import React, { useState } from "react";
import { expect, spyOn, waitFor, within } from "storybook/test";
import WebLoginModal from "./WebLoginModal";

function LoginStory(props) {
  const [open, setOpen] = useState(true);
  return <WebLoginModal {...props} isOpen={open} onClose={() => setOpen(false)} />;
}

// Offline Storybook fixture only: intercept before React assigns the remote
// iframe URL so the reserved example host never receives a network request.
function offlineLoginFrame() {
  const setAttribute = Element.prototype.setAttribute;
  const interception = spyOn(Element.prototype, "setAttribute").mockImplementation(function (name, value) {
    if (this instanceof HTMLIFrameElement && name.toLowerCase() === "src" && String(value).startsWith("https://login.gateway.example/")) {
      setAttribute.call(this, "srcdoc", '<!doctype html><html><head><title>Provider login page fixture</title></head><body><h1>Provider login page fixture</h1><p>Offline Storybook fixture, not a live provider sign-in.</p></body></html>');
      return;
    }
    return setAttribute.call(this, name, value);
  });
  return () => interception.mockRestore();
}

const routes = {
  "POST /api/providers/web-login/start": { status: 200, body: { pageUrl: "https://login.gateway.example/__web_login/bootstrap?grant=story-iframe" } },
  "GET /api/providers/web-login/status": { status: 200, body: { provider: "grok-web", captured: [], ready: false } },
  "POST /api/providers/web-login/popup": { status: 200, body: { pageUrl: "https://login.gateway.example/__web_login/bootstrap?grant=story-popup" } },
  "POST /api/providers/web-login/finish": { status: 200, body: { id: "story-connection", provider: "grok-web", name: "Personal account" } },
  "POST /api/providers/web-login/cancel": { status: 200, body: { success: true } },
};

export default {
  title: "Production/shared-web-login/WebLoginModal",
  component: WebLoginModal,
  args: { provider: "grok-web", providerName: "Grok Web", initialName: "Personal account" },
  render: (args) => <LoginStory {...args} />,
  beforeEach: offlineLoginFrame,
  parameters: { layout: "centered", storyFixture: { scenario: "default", pathname: "/dashboard/providers/grok-web", params: {}, routes } },
};

export const Waiting = {
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Sign in to Grok Web" });
    await within(dialog).findByText(/Waiting for sign-in/);
    expect(within(dialog).getByText(/Captured cookies: none/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save connection" })).toBeDisabled();
    expect(within(dialog).getByTitle("Grok Web login")).toHaveAttribute("srcdoc", expect.stringContaining("Provider login page fixture"));
  },
};
export const Ready = {
  parameters: { storyFixture: { routes: { ...routes, "GET /api/providers/web-login/status": { status: 200, body: { provider: "grok-web", captured: ["sso"], ready: true } } } } },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Sign in to Grok Web" });
    await waitFor(() => expect(within(dialog).getByText(/Ready to save/)).toBeVisible(), { timeout: 5000 });
    expect(within(dialog).getByRole("button", { name: "Save connection" })).toBeEnabled();
  },
};
export const OriginNotConfigured = {
  parameters: { storyFixture: { routes: { ...routes, "POST /api/providers/web-login/start": { status: 503, body: { error: "Configure a separate login origin or use manual cookie paste." } } } } },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Sign in to Grok Web" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Configure a separate login origin or use manual cookie paste.");
    expect(within(dialog).queryByTitle("Grok Web login")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save connection" })).toBeDisabled();
  },
};
