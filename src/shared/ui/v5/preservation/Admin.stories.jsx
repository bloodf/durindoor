import React, { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { CLI_TOOLS } from "@/shared/constants/cliTools.js";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers.js";
import ToolDetailClient from "@/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js";
import CLIToolsPageClient from "@/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.js";
import MediaProviderKindPage from "@/app/(dashboard)/dashboard/media-providers/[kind]/page.js";
import WebProvidersPage from "@/app/(dashboard)/dashboard/media-providers/web/page.js";
import ProfilePage from "@/app/(dashboard)/dashboard/profile/page.js";
import MfaCard from "@/app/(dashboard)/dashboard/profile/MfaCard.jsx";
import DatabaseSettingsPage from "@/app/(dashboard)/dashboard/settings/database/page.js";
import McpGatewayPage from "@/app/(dashboard)/dashboard/mcp-gateway/McpGatewayPage.jsx";
import McpGatewayKeysPage from "@/app/(dashboard)/dashboard/mcp-gateway/keys/McpGatewayKeysPage.jsx";
import MitmPageClient from "@/app/(dashboard)/dashboard/mitm/MitmPageClient.js";
import LoginPage from "@/app/login/page.js";
import { LoginView } from "@/app/login/LoginView.js";
import { ADMIN_PASSWORD, ADMIN_MFA_SECRET, ADMIN_BACKUP_CODES, createAdminFixture } from "./admin-fixtures.js";

const meta = { title: "Preservation/Administration", parameters: { layout: "fullscreen" } };
export default meta;

function story(Component, pathname, options = {}, play, args = {}, params = {}) {
  const fixture = createAdminFixture(options);
  const definition = {
    args,
    render: (props) => <Component {...props} />,
    beforeEach: () => {
      fixture.reset();
      if (!options.allowRedirect) return;
      const previous = document.documentElement.dataset.v5Review;
      document.documentElement.dataset.v5Review = "true";
      return () => {
        if (previous === undefined) delete document.documentElement.dataset.v5Review;
        else document.documentElement.dataset.v5Review = previous;
      };
    },
    parameters: {
      storyFixture: { scenario: "default", pathname, params, routes: fixture.routes },
    },
  };
  if (options.keepRedirectVisible) definition.parameters.v5Review = { keepRedirectVisible: true };
  if (play) definition.play = (context) => play(context, fixture);
  return definition;
}
const body = () => within(document.body);
async function dialog(name) {
  const element = await body().findByRole("dialog", { name });
  await waitFor(() => expect(element).toBeVisible());
  return within(element);
}
async function select(container, label, option) {
  await userEvent.click(container.getByRole("combobox", { name: label }));
  await userEvent.click(await body().findByRole("option", { name: option, exact: true }));
}
const lastCall = (fixture, method, path) => fixture.calls.filter((call) => call.method === method && call.path === path).at(-1);
async function submitted(fixture, method, path, payload) {
  await waitFor(() => expect(lastCall(fixture, method, path)?.payload).toMatchObject(payload));
}
async function login(context) {
  const canvas = within(context.canvasElement);
  await userEvent.type(await canvas.findByLabelText(/^Password(?: \*)?$/), ADMIN_PASSWORD);
  await userEvent.click(canvas.getByRole("button", { name: "Login", exact: true }));
  return canvas;
}
const cli = (toolId) => story(ToolDetailClient, `/dashboard/cli-tools/${toolId}`, {}, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("heading", { name: CLI_TOOLS[toolId].name, exact: true })).toBeVisible();
}, { toolId, machineId: "review-machine" }, { toolId });
const media = (kind) => story(["webSearch", "webFetch"].includes(kind) ? WebProvidersPage : MediaProviderKindPage, `/dashboard/media-providers/${kind}`, {}, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const label = MEDIA_PROVIDER_KINDS.find((item) => item.id === kind).label;
  if (["webSearch", "webFetch"].includes(kind)) await expect(await canvas.findByRole("heading", { name: label, exact: true })).toBeVisible();
  else await expect(await canvas.findByRole("region", { name: `${label} providers` }).catch(() => canvas.findByText(`No ${label} providers`))).toBeVisible();
}, {}, { kind });

export const CliCatalog = story(CLIToolsPageClient, "/dashboard/cli-tools", {}, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  for (const tool of Object.values(CLI_TOOLS)) await expect(await canvas.findByText(tool.name, { exact: true })).toBeVisible();
}, { machineId: "review-machine" });
export const CliClaude = cli("claude");
export const CliCodex = cli("codex");
export const CliOpenCode = cli("opencode");
export const CliCowork = cli("cowork");
export const CliDroid = cli("droid");
export const CliOpenClaw = cli("openclaw");
export const CliHermes = cli("hermes");
export const CliCopilot = cli("copilot");
export const CliCursor = cli("cursor");
export const CliCline = cli("cline");
export const CliKilo = cli("kilo");
export const CliRoo = cli("roo");
export const CliContinue = cli("continue");
export const CliAmpUnsupported = cli("amp");
export const CliQwen = cli("qwen");
export const CliDeepSeekTui = cli("deepseek-tui");
export const CliJcode = cli("jcode");
export const CliGrokBuild = cli("grok-build");
export const CliOmp = cli("omp");
export const CliPi = cli("pi");
export const CliCrush = cli("crush");
export const CliForge = cli("forge");
export const CliSmelt = cli("smelt");
export const CliCodeWhale = cli("codewhale");
export const MediaEmbedding = media("embedding");
export const MediaRerank = media("rerank");
export const MediaImage = media("image");
export const MediaImageToText = media("imageToText");
export const MediaTts = media("tts");
export const MediaStt = media("stt");
export const MediaWebSearch = media("webSearch");
export const MediaWebFetch = media("webFetch");
export const MediaVideo = media("video");
export const MediaMusic = media("music");
export const MediaSystemOne = media("systemone");

export const LoginMfaRejected = story(LoginPage, "/login", { login: "mfa" }, async (context, fixture) => {
  const canvas = await login(context);
  await userEvent.type(await canvas.findByLabelText(/^Authentication code(?: \*)?$/), "000000");
  await userEvent.click(canvas.getByRole("button", { name: "Verify", exact: true }));
  await submitted(fixture, "POST", "/api/auth/mfa/verify", { code: "000000" });
  await expect(await canvas.findByText("Review code rejected")).toBeVisible();
});
export const LoginBackupCodeAndReturn = story(LoginPage, "/login", { login: "mfa" }, async (context, fixture) => {
  const canvas = await login(context);
  await userEvent.type(await canvas.findByLabelText(/^Authentication code(?: \*)?$/), ADMIN_BACKUP_CODES[0]);
  await userEvent.click(canvas.getByRole("button", { name: "Verify", exact: true }));
  await submitted(fixture, "POST", "/api/auth/mfa/verify", { code: ADMIN_BACKUP_CODES[0] });
  await userEvent.click(canvas.getByRole("button", { name: "Back to sign in" }));
  await expect(await canvas.findByLabelText(/^Password(?: \*)?$/)).toBeVisible();
  await expect(canvas.queryByLabelText(/^Authentication code(?: \*)?$/)).not.toBeInTheDocument();
});
export const LoginLockExpires = story(LoginPage, "/login", { login: "locked" }, async (context) => {
  const canvas = await login(context);
  await expect(await canvas.findByText(/Locked\. Retry in/)).toBeVisible();
  await waitFor(() => expect(canvas.getByRole("button", { name: "Login", exact: true })).toBeEnabled(), { timeout: 5000 });
});
export const LoginMfaLock = story(LoginPage, "/login", { login: "mfa", mfaLocked: true }, async (context) => {
  const canvas = await login(context);
  await userEvent.type(await canvas.findByLabelText(/^Authentication code(?: \*)?$/), "000000");
  await userEvent.click(canvas.getByRole("button", { name: "Verify", exact: true }));
  await expect(await canvas.findByText(/Locked\. Retry in/)).toBeVisible();
});
export const LoginPasswordChangeProof = story(LoginPage, "/login", { login: "change" }, async (context, fixture) => {
  const canvas = await login(context);
  await userEvent.type(await canvas.findByLabelText(/^New password(?: \*)?$/), "review-new-password");
  await userEvent.click(canvas.getByRole("button", { name: "Set password" }));
  await submitted(fixture, "POST", "/api/auth/change-password", { proof: "review-proof", newPassword: "review-new-password" });
  await expect(await canvas.findByText("Review password change rejected")).toBeVisible();
});
export const LoginRemoteDefaultRestriction = story(LoginPage, "/login", { login: "remote" }, async (context) => {
  const canvas = await login(context);
  await expect(await canvas.findByText(/Sign in from the local machine/)).toBeVisible();
});
export const LoginOidcRecovery = story(LoginPage, "/login", { auth: { authMode: "oidc", oidcConfigured: false } }, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText(/Password login is still available for recovery/)).toBeVisible();
});
export const LoginPasswordSuccessRedirect = story(LoginPage, "/login", { login: "success", allowRedirect: true, keepRedirectVisible: true }, async (context, fixture) => {
  const redirects = [];
  const record = (event) => redirects.push(event.detail.destination);
  window.addEventListener("v5-review-redirect", record);
  try {
    await login(context);
    await submitted(fixture, "POST", "/api/auth/login", { password: ADMIN_PASSWORD });
    await waitFor(() => expect(redirects).toEqual(["/dashboard"]));
  } finally { window.removeEventListener("v5-review-redirect", record); }
});
export const LoginMfaSuccessRedirect = story(LoginPage, "/login", { login: "mfa", mfaSuccess: true, allowRedirect: true, keepRedirectVisible: true }, async (context, fixture) => {
  const redirects = [];
  const record = (event) => redirects.push(event.detail.destination);
  window.addEventListener("v5-review-redirect", record);
  try {
    const canvas = await login(context);
    await userEvent.type(await canvas.findByLabelText(/^Authentication code(?: \*)?$/), "123456");
    await userEvent.click(canvas.getByRole("button", { name: "Verify", exact: true }));
    await submitted(fixture, "POST", "/api/auth/mfa/verify", { code: "123456" });
    await waitFor(() => expect(redirects).toEqual(["/dashboard"]));
  } finally { window.removeEventListener("v5-review-redirect", record); }
});
export const LoginOidcStartBoundary = story(LoginPage, "/login", { auth: { authMode: "oidc", oidcConfigured: true, oidcLoginLabel: "Review SSO" }, allowRedirect: true }, async ({ canvasElement }, fixture) => {
  const redirects = [];
  const record = (event) => redirects.push(event.detail.destination);
  window.addEventListener("v5-review-redirect", record);
  try {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Review SSO" }));
    await expect(redirects).toEqual(["/api/auth/oidc/start"]);
    await expect(fixture.calls.some((call) => call.path === "/api/auth/oidc/start")).toBe(false);
  } finally { window.removeEventListener("v5-review-redirect", record); }
});
function OidcLoginPresentation() {
  const [clicked, setClicked] = useState(false);
  const handleOidcLogin = fn(() => setClicked(true));
  return <><LoginView authMode="oidc" oidcConfigured oidcAvailable passwordAvailable={false} oidcLoginLabel="Review SSO" handleOidcLogin={handleOidcLogin} />{clicked && <p role="status">OIDC start callback received in preview</p>}</>;
}
export const LoginOidcButton = story(OidcLoginPresentation, "/login", {}, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Review SSO" }));
  await expect(canvas.getByRole("status")).toHaveTextContent("OIDC start callback received in preview");
});

export const DatabaseUnlockRejectsThenAccepts = story(DatabaseSettingsPage, "/dashboard/settings/database", {}, async (_, fixture) => {
  let modal = await dialog("Dashboard password required");
  await userEvent.type(modal.getByPlaceholderText("Dashboard password"), "wrong-review-password");
  await userEvent.click(modal.getByRole("button", { name: "Unlock" }));
  modal = await dialog("Dashboard password required");
  await waitFor(() => expect(modal.getByText(/Password rejected/)).toBeVisible());
  await userEvent.type(modal.getByPlaceholderText("Dashboard password"), ADMIN_PASSWORD);
  await userEvent.click(modal.getByRole("button", { name: "Unlock" }));
  await expect(await body().findByText("sqlite", { exact: true })).toBeVisible();
  await expect(lastCall(fixture, "GET", "/api/settings/database/engine").password).toBe(ADMIN_PASSWORD);
});
export const DatabaseTestAndCutover = story(DatabaseSettingsPage, "/dashboard/settings/database", {}, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  for (const [label, value] of [["Target host", "db.example.test"], ["Target database", "review"], ["Target user", "review"], ["Target password", "review"]]) {
    const input = await canvas.findByLabelText(label); await userEvent.clear(input); await userEvent.type(input, value);
  }
  await userEvent.click(canvas.getByRole("button", { name: "Test connection and save target" }));
  await expect(await canvas.findByText(/Connected in 8ms/)).toBeVisible();
  await submitted(fixture, "POST", "/api/settings/database/test", { host: "db.example.test", database: "review", user: "review", password: "review", persist: true });
  await userEvent.click(canvas.getByRole("button", { name: "Cut over to Postgres" }));
  const modal = await dialog("Cut over to Postgres");
  await userEvent.click(modal.getByRole("button", { name: "Cut over", exact: true }));
  await waitFor(() => expect(fixture.snapshot().engine.activeEngine).toBe("postgres"));
  await expect(await canvas.findByText("postgres", { exact: true })).toBeVisible();
}, { initialPassword: ADMIN_PASSWORD });
export const DatabaseRollback = story(DatabaseSettingsPage, "/dashboard/settings/database", { engine: "postgres" }, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "Switch back to SQLite" }));
  const modal = await dialog("Switch back to SQLite");
  await userEvent.click(modal.getByRole("button", { name: "Rollback" }));
  await submitted(fixture, "POST", "/api/settings/database/rollback", { force: true });
  await expect(await canvas.findByText("sqlite", { exact: true })).toBeVisible();
}, { initialPassword: ADMIN_PASSWORD });
export const DatabaseFallbackAndCutoverError = story(DatabaseSettingsPage, "/dashboard/settings/database", { engineError: true, databaseError: true }, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Serving SQLite", { exact: true })).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Cut over to Postgres" }));
  await userEvent.click((await dialog("Cut over to Postgres")).getByRole("button", { name: "Cut over", exact: true }));
  await expect(await canvas.findByRole("alert")).toHaveTextContent("Review cutover rejected");
}, { initialPassword: ADMIN_PASSWORD });

function MfaPresentation({ enabled = false }) {
  const [settings, setSettings] = useState({ mfaEnabled: enabled, mfaBackupCodesRemaining: enabled ? 2 : 0 });
  return <MfaCard {...settings} onChanged={(patch) => setSettings((current) => ({ ...current, ...patch }))} />;
}
async function enroll(_, fixture) {
  await userEvent.click(body().getByRole("button", { name: "Enable two-factor" }));
  let modal = await dialog("Enable two-factor authentication");
  await userEvent.type(modal.getByLabelText(/^Current password(?: \*)?$/), ADMIN_PASSWORD);
  await userEvent.click(modal.getByRole("button", { name: "Continue" }));
  const qr = await body().findByAltText("Authenticator QR code");
  await waitFor(() => expect(qr).toBeVisible());
  modal = await dialog("Enable two-factor authentication");
  await expect(modal.getByText(ADMIN_MFA_SECRET)).toBeVisible();
  await userEvent.type(modal.getByLabelText(/^6-digit code(?: \*)?$/), "123456");
  await userEvent.click(modal.getByRole("button", { name: "Verify and enable" }));
  await submitted(fixture, "POST", "/api/auth/mfa/enable", { password: ADMIN_PASSWORD, secret: ADMIN_MFA_SECRET, code: "123456" });
  await expect(await body().findByText(ADMIN_BACKUP_CODES[0])).toBeVisible();
  await userEvent.click(body().getByRole("button", { name: "I've saved my backup codes" }));
  await expect(body().queryByText(ADMIN_BACKUP_CODES[0])).not.toBeInTheDocument();
}
export const MfaEnrollmentAndOneTimeCodes = story(MfaPresentation, "/dashboard/profile", {}, enroll);
export const MfaDisableWithBackupCode = story(MfaPresentation, "/dashboard/profile", { settings: { mfaEnabled: true, mfaBackupCodesRemaining: 2 } }, async (_, fixture) => {
  await userEvent.click(body().getByRole("button", { name: "Disable two-factor" }));
  const modal = await dialog("Disable two-factor authentication");
  await userEvent.type(modal.getByLabelText(/^Current password(?: \*)?$/), ADMIN_PASSWORD);
  await userEvent.type(modal.getByLabelText(/^Authentication or backup code(?: \*)?$/), ADMIN_BACKUP_CODES[0]);
  await userEvent.click(modal.getByRole("button", { name: "Disable two-factor", exact: true }));
  await submitted(fixture, "POST", "/api/auth/mfa/disable", { password: ADMIN_PASSWORD, code: ADMIN_BACKUP_CODES[0] });
  await expect(await body().findByRole("button", { name: "Enable two-factor" })).toBeVisible();
}, { enabled: true });
export const SettingsMfaEnrollment = story(ProfilePage, "/dashboard/profile", {}, async (context, fixture) => {
  const canvas = within(context.canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name: /Security/ }));
  await canvas.findByRole("button", { name: "Enable two-factor" });
  await enroll(context, fixture);
});
export const SettingsOidcSaveAndTestFailure = story(ProfilePage, "/dashboard/profile", { oidcError: true }, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name: /Security/ }));
  const toggle = await canvas.findByRole("button", { name: "Toggle OIDC settings" });
  await waitFor(() => expect(toggle).toBeEnabled());
  if (toggle.getAttribute("aria-expanded") !== "true") await userEvent.click(toggle);
  const client = await canvas.findByLabelText("Client ID");
  await waitFor(() => expect(client).toBeEnabled());
  await userEvent.clear(client);
  await userEvent.type(client, "changed-review-client");
  await userEvent.click(canvas.getByRole("button", { name: "Test connection" }));
  await submitted(fixture, "PATCH", "/api/settings", { oidcClientId: "changed-review-client", authMode: "both" });
  await submitted(fixture, "POST", "/api/auth/oidc/test", { clientId: "changed-review-client" });
  await expect(lastCall(fixture, "PATCH", "/api/settings").payload).not.toHaveProperty("oidcClientSecret");
  await expect(await canvas.findByText("Review issuer discovery failed")).toBeVisible();
});
export const SettingsBackupImport = story(ProfilePage, "/dashboard/profile", {}, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name: /System & Data/ }));
  await userEvent.upload(canvas.getByLabelText("Import database backup"), new File([JSON.stringify({ settings: { theme: "dark" }, providerConnections: [], combos: [] })], "review-backup.json", { type: "application/json" }));
  const modal = await dialog("Confirm Password");
  await userEvent.type(modal.getByPlaceholderText("Current password"), ADMIN_PASSWORD);
  await userEvent.click(modal.getByRole("button", { name: "Confirm" }));
  await submitted(fixture, "POST", "/api/settings/database", { password: ADMIN_PASSWORD, settings: { theme: "dark" } });
  await expect(await canvas.findByText("Database imported successfully")).toBeVisible();
});
export const SettingsBackupPasswordFailure = story(ProfilePage, "/dashboard/profile", {}, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name: /System & Data/ }));
  await userEvent.click(canvas.getByRole("button", { name: "Download Backup" }));
  const modal = await dialog("Confirm Password");
  await userEvent.type(modal.getByPlaceholderText("Current password"), "wrong-review-password");
  await userEvent.click(modal.getByRole("button", { name: "Confirm" }));
  await expect(await canvas.findByText("Review password rejected")).toBeVisible();
});
export const SettingsRetentionCleanup = story(ProfilePage, "/dashboard/profile", {}, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name: /System & Data/ }));
  const clean = canvas.getByRole("button", { name: "Clean now" });
  await waitFor(() => expect(clean).toBeEnabled());
  await userEvent.click(clean);
  await submitted(fixture, "POST", "/api/data-retention", {});
  await waitFor(() => expect(fixture.snapshot().retentionRuns).toBe(1));
  await expect(canvas.getByRole("button", { name: "Clean now" })).toBeEnabled();
});
export const SettingsRetentionFailure = story(ProfilePage, "/dashboard/profile", { retentionError: true }, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name: /System & Data/ }));
  const clean = canvas.getByRole("button", { name: "Clean now" });
  await waitFor(() => expect(clean).toBeEnabled());
  await userEvent.click(clean);
  await expect(await canvas.findByText("Review cleanup rejected")).toBeVisible();
});

export const McpStdioFieldsPersist = story(McpGatewayPage, "/dashboard/mcp-gateway", {}, async ({ canvasElement }, fixture) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Edit review-stdio" }));
  const modal = await dialog("Edit instance");
  await expect(modal.getByLabelText(/^Command(?: \*)?$/)).toHaveValue("review-command");
  await userEvent.clear(modal.getByLabelText("Args (JSON array)"));
  await userEvent.paste('["--review-updated"]');
  await userEvent.click(modal.getByRole("button", { name: "Save", exact: true }));
  await submitted(fixture, "PUT", "/api/mcp-gateway/instances/review-stdio", { transport: "stdio", args: ["--review-updated"], env: { REVIEW_ONLY: "true" } });
});
export const McpHttpHeadersPersist = story(McpGatewayPage, "/dashboard/mcp-gateway", {}, async ({ canvasElement }, fixture) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Edit review-http" }));
  const modal = await dialog("Edit instance");
  await userEvent.clear(modal.getByLabelText("Headers (JSON object)"));
  await userEvent.paste('{"X-Review":"true"}');
  await userEvent.click(modal.getByRole("button", { name: "Save", exact: true }));
  await submitted(fixture, "PUT", "/api/mcp-gateway/instances/review-http", { transport: "http", headers: { "X-Review": "true" }, oauth: true });
});
export const McpTransportSwitch = story(McpGatewayPage, "/dashboard/mcp-gateway", {}, async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "New instance" }));
  const modal = await dialog("New instance");
  await select(modal, "Transport", "stdio");
  await waitFor(() => expect(modal.getByLabelText(/^Command(?: \*)?$/)).toBeVisible());
  await expect(modal.queryByLabelText(/^URL(?: \*)?$/)).not.toBeInTheDocument();
  await select(modal, "Transport", "sse");
  await waitFor(() => expect(modal.getByLabelText(/^URL(?: \*)?$/)).toBeVisible());
  await expect(modal.queryByLabelText(/^Command(?: \*)?$/)).not.toBeInTheDocument();
});
const grantFailure = (options) => story(McpGatewayKeysPage, "/dashboard/mcp-gateway/keys", options, async ({ canvasElement }, fixture) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Manage grants" }));
  const modal = await dialog("Manage instance grants");
  await waitFor(() => expect(modal.getByText(/could not be loaded/)).toBeVisible());
  await expect(modal.getByRole("button", { name: "Save grants" })).toBeDisabled();
  await expect(fixture.snapshot().grants).toEqual(["review-http"]);
  await expect(lastCall(fixture, "PUT", "/api/mcp-gateway/keys/review-mcp-key")).toBeUndefined();
});
export const McpGrantsFailureRetainsAccess = grantFailure({ grantsError: true });
export const McpInstanceFailureRetainsAccess = grantFailure({ instancesError: true });
export const McpGrantsPersistAndReopen = story(McpGatewayKeysPage, "/dashboard/mcp-gateway/keys", {}, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "Manage grants" }));
  let modal = await dialog("Manage instance grants");
  await userEvent.click(await modal.findByLabelText(/review-stdio/));
  await userEvent.click(modal.getByRole("button", { name: "Save grants" }));
  await submitted(fixture, "PUT", "/api/mcp-gateway/keys/review-mcp-key", { grants: ["review-http", "review-stdio"] });
  await waitFor(() => expect(body().queryByRole("dialog")).not.toBeInTheDocument());
  await userEvent.click(canvas.getByRole("button", { name: "Manage grants" }));
  modal = await dialog("Manage instance grants");
  await expect(await modal.findByLabelText(/review-stdio/)).toBeChecked();
});
export const MitmServerStop = story(MitmPageClient, "/dashboard/mitm", {}, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "Stop Server" }));
  await submitted(fixture, "DELETE", "/api/cli-tools/antigravity-mitm", { sudoPassword: "" });
  await expect(await canvas.findByRole("button", { name: "Start Server" })).toBeVisible();
});
export const MitmCertificateTrust = story(MitmPageClient, "/dashboard/mitm", { mitmRunning: false, mitm: { certTrusted: false } }, async ({ canvasElement }, fixture) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Trust Cert" }));
  await submitted(fixture, "PATCH", "/api/cli-tools/antigravity-mitm", { action: "trust-cert", sudoPassword: "" });
  await waitFor(() => expect(fixture.snapshot().mitm.certTrusted).toBe(true));
});
export const MitmPortConflict = story(MitmPageClient, "/dashboard/mitm", { mitmRunning: false, portConflict: true }, async ({ canvasElement }) => {
  const start = await within(canvasElement).findByRole("button", { name: "Start Server" });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  await dialog("Port 443 Already In Use");
});
export const MitmWindowsPrivilegeBoundary = story(MitmPageClient, "/dashboard/mitm", { mitmRunning: false, mitm: { isWin: true, isAdmin: true } }, async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("button", { name: "Start Server" })).toBeDisabled();
  await expect(await canvas.findByText(/Restart DurinDoor as a standard user\./)).toBeVisible();
});
export const MitmKiroDnsAndMappings = story(MitmPageClient, "/dashboard/mitm", {}, async ({ canvasElement }, fixture) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: /Kiro.*DNS off/ }));
  await userEvent.click(canvas.getByRole("button", { name: "Start DNS" }));
  await submitted(fixture, "PATCH", "/api/cli-tools/antigravity-mitm", { tool: "kiro", action: "enable", sudoPassword: "" });
  await expect(await canvas.findByRole("button", { name: "Stop DNS" })).toBeVisible();
  const inputs = canvas.getAllByPlaceholderText("provider/model-id");
  await userEvent.type(inputs[0], "openai/gpt-4.1");
  await userEvent.tab();
  await waitFor(() => expect(Object.values(lastCall(fixture, "PUT", "/api/cli-tools/antigravity-mitm/alias")?.payload.mappings || {})).toContainEqual({ model: "openai/gpt-4.1" }));
});
export const CustomSystemOneCreate = story(MediaProviderKindPage, "/dashboard/media-providers/systemone", {}, async ({ canvasElement }, fixture) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Add Custom System One" }));
  const modal = await dialog("Add Custom System One");
  await userEvent.type(modal.getByLabelText("Name"), "Review System One");
  await userEvent.type(modal.getByLabelText("Prefix"), "review-systemone");
  await userEvent.clear(modal.getByLabelText("Base URL"));
  await userEvent.type(modal.getByLabelText("Base URL"), "https://systemone.example.test/v1");
  await userEvent.click(modal.getByRole("button", { name: "Save", exact: true }));
  await submitted(fixture, "POST", "/api/provider-nodes", { name: "Review System One", prefix: "review-systemone", baseUrl: "https://systemone.example.test/v1", type: "systemone-compatible" });
  await expect(await within(canvasElement).findByText("Review System One")).toBeVisible();
}, {}, { kind: "systemone" });
