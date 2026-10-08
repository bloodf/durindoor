import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import LoginPage from "./page.js";
import { LoginView } from "./LoginView.js";

const BASE = {
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

export const Default = {
  render: () => <LoginPage />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByLabelText("Password")).toBeVisible();
  },
};

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

// Route-owned scenarios exercise the real login state machine, rather than
// attributing presentational LoginView props to LoginPage.
const loginFixture = (loginResponse, extraRoutes = {}) => ({
  scenario: "default",
  pathname: "/login",
  routes: {
    "GET /api/auth/status": { body: { authenticated: false, requireLogin: true, hasPassword: true, authMode: "password" } },
    "POST /api/auth/login": loginResponse,
    ...extraRoutes,
  },
});

async function submitPassword(canvas) {
  await userEvent.type(await canvas.findByLabelText("Password"), "fixture-password");
  await userEvent.click(canvas.getByRole("button", { name: "Login", exact: true }));
}

export const RejectedPassword = {
  render: () => <LoginPage />,
  parameters: { storyFixture: loginFixture({ status: 401, body: { error: "Invalid password", resetHint: "Reset with CLI" } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await submitPassword(canvas);
    await expect(await canvas.findByText("Invalid password")).toBeVisible();
    await expect(canvas.getByText("Reset Password to Default")).toBeVisible();
  },
};

export const MfaChallenge = {
  render: () => <LoginPage />,
  parameters: { storyFixture: loginFixture({ body: { mfaRequired: true } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await submitPassword(canvas);
    await expect(await canvas.findByLabelText("Authentication code")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Verify" })).toBeDisabled();
  },
};

export const MfaRejected = {
  render: () => <LoginPage />,
  parameters: {
    storyFixture: loginFixture({ body: { mfaRequired: true } }, {
      "POST /api/auth/mfa/verify": { status: 400, body: { error: "Invalid code" } },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await submitPassword(canvas);
    await userEvent.type(await canvas.findByLabelText("Authentication code"), "000000");
    await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
    await expect(await canvas.findByText("Invalid code")).toBeVisible();
    await expect(canvas.getByLabelText("Authentication code")).toHaveValue("");
  },
};

export const PasswordUpdate = {
  render: () => <LoginPage />,
  parameters: { storyFixture: loginFixture({ body: { mustChangePassword: true, requiresPasswordChange: true, proof: "fixture-proof" } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await submitPassword(canvas);
    await expect(await canvas.findByLabelText("New password")).toBeVisible();
    await expect(canvas.getByText("Password update required")).toBeVisible();
  },
};

export const RemoteDefaultPasswordBlocked = {
  render: () => <LoginPage />,
  parameters: { storyFixture: loginFixture({ status: 403, body: { mustChangePassword: true } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await submitPassword(canvas);
    await expect(await canvas.findByText("Default password", { exact: true })).toBeVisible();
    await expect(canvas.queryByLabelText("Password")).not.toBeInTheDocument();
  },
};

export const UnconfiguredPassword = {
  render: () => <LoginPage />,
  parameters: {
    storyFixture: loginFixture({ status: 401, body: { error: "Invalid password" } }, {
      "GET /api/auth/status": { body: { authenticated: false, requireLogin: true, hasPassword: false, authMode: "password" } },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Security risk: no password set. You will be asked to set one when logging in remotely.")).toBeVisible();
  },
};

export const ConfiguredOidc = {
  render: () => <LoginPage />,
  parameters: {
    storyFixture: loginFixture({ status: 401, body: { error: "Invalid password" } }, {
      "GET /api/auth/status": { body: { authenticated: false, requireLogin: true, hasPassword: true, authMode: "oidc", oidcConfigured: true, oidcLoginLabel: "Sign in with Example ID" } },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Sign in with Example ID" })).toBeVisible();
    await expect(canvas.queryByLabelText("Password")).not.toBeInTheDocument();
  },
};

export const UpdatedPasswordRequiresReauthentication = {
  render: () => <LoginPage />,
  parameters: {
    storyFixture: loginFixture({ body: { mustChangePassword: true, requiresPasswordChange: true, proof: "fixture-proof" } }, {
      "POST /api/auth/change-password": { body: { reauthenticate: true } },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await submitPassword(canvas);
    await userEvent.type(await canvas.findByLabelText("New password"), "fixture-new-password");
    await userEvent.click(canvas.getByRole("button", { name: "Set password" }));
    await expect(await canvas.findByText("Password updated. Please sign in with your new password.")).toBeVisible();
    await expect(canvas.getByLabelText("Password")).toHaveValue("");
  },
};
