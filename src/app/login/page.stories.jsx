import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import LoginPage from "./page.js";
import { LoginView } from "./LoginView.js";

const BASE = {
  wordmarkFailed: true,
  authMode: "password",
  oidcConfigured: false,
  oidcLoginLabel: "Sign in with OIDC",
  oidcAvailable: false,
  passwordAvailable: true,
  usingDefaultPassword: false,
  hasPassword: true,
  mustChange: false,
  passwordChangeProof: "",
  error: "",
  password: "",
  setPassword: () => {},
  newPassword: "",
  setNewPassword: () => {},
  loading: false,
  retryAfter: 0,
  resetHint: "",
  handleLogin: (event) => event.preventDefault(),
  handleSetNewPassword: (event) => event.preventDefault(),
  handleOidcLogin: () => {},
};

function StatefulLoginView({ initial = BASE }) {
  const [password, setPassword] = useState(initial.password);
  const [newPassword, setNewPassword] = useState(initial.newPassword);
  return <LoginView {...initial} password={password} setPassword={setPassword} newPassword={newPassword} setNewPassword={setNewPassword} />;
}

export default {
  title: "Production/Public/Login",
  component: LoginPage,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/login",
      routes: {
        "GET /api/auth/status": { status: 200, body: { authenticated: false, requireLogin: true, hasPassword: true, authMode: "password", oidcConfigured: false } },
        "POST /api/auth/login": { status: 401, body: { error: "Invalid password" } },
      },
    },
  },
};

export const Default = { render: () => <LoginPage /> };

export const PasswordEntry = {
  render: () => <StatefulLoginView />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const password = canvas.getByLabelText(/password/i, { selector: "#dashboard-password" });
    await userEvent.type(password, "wrong-password");
    await expect(password).toHaveValue("wrong-password");
  },
};

export const OIDCAndPassword = { render: () => <StatefulLoginView initial={{ ...BASE, authMode: "both", oidcConfigured: true, oidcAvailable: true, passwordAvailable: true }} /> };
export const RateLimited = { render: () => <StatefulLoginView initial={{ ...BASE, retryAfter: 17 }} /> };
export const PasswordChangeRequired = { render: () => <StatefulLoginView initial={{ ...BASE, mustChange: true, passwordChangeProof: "local-proof", newPassword: "new-secret" }} /> };
export const LoginErrorAndResetHint = { render: () => <StatefulLoginView initial={{ ...BASE, error: "Invalid password", resetHint: "Run the reset CLI command." }} /> };
export const OIDCOnly = { render: () => <StatefulLoginView initial={{ ...BASE, authMode: "oidc", oidcConfigured: true, oidcAvailable: true, passwordAvailable: false, oidcLoginLabel: "Sign in with Okta" }} /> };
export const OIDCMisconfigured = {
  render: () => (
    <StatefulLoginView
      initial={{
        ...BASE,
        authMode: "oidc",
        oidcConfigured: false,
        oidcAvailable: false,
        passwordAvailable: true,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/OIDC login is enabled, but the issuer\/client fields are not configured yet/i)).toBeInTheDocument();
    await expect(canvas.getByLabelText(/password/i, { selector: "#dashboard-password" })).toBeRequired();
  },
};
