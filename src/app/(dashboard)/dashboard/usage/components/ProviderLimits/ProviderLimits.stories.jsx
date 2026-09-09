import React, { Suspense } from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";
import ProviderLimits from "./index.js";

const codex = {
  id: "codex-primary",
  provider: "codex",
  name: "Primary Codex",
  email: "owner@example.com",
  authType: "oauth",
  isActive: true,
  providerSpecificData: { plan: "Pro" },
};

const kiro = {
  id: "kiro-team",
  provider: "kiro",
  name: "Kiro team",
  email: "team@example.com",
  authType: "oauth",
  isActive: true,
  testStatus: "success",
  providerSpecificData: {
    authMethod: "builder-id",
    region: "us-east-1",
    profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/team",
  },
};

const codexSecondary = {
  id: "codex-secondary",
  provider: "codex",
  name: "Secondary Codex",
  email: "second@example.com",
  authType: "oauth",
  isActive: true,
  providerSpecificData: { plan: "Pro" },
};

const connectionPage = (connections, { total = connections.length, page = 1, pageSize = 20, providerOptions = ["codex", "kiro"] } = {}) => ({
  connections,
  providerOptions,
  pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  totals: { eligibleConnections: total, providerFilteredConnections: connections.length },
});

const codexQuota = {
  plan: "Pro",
  rate_limit: { primary_window: { used_percent: 35, reset_at: Date.now() + 3_600_000 } },
  resetCredits: { availableCount: 2 },
};

const settingsRoutes = () => {
  let settings = { quotaTrackerState: {}, claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} }, quotaVisibility: {} };
  return {
    "GET /api/settings": () => ({ body: settings, status: 200 }),
    "PATCH /api/settings": async (request) => {
      settings = { ...settings, ...await request.json() };
      return { body: settings, status: 200 };
    },
  };
};

const baseRoutes = (connections = [codex, kiro]) => ({
  ...settingsRoutes(),
  "GET /api/proxy-pools": { body: { proxyPools: [] }, status: 200 },
  "GET /api/providers/client": { body: connectionPage(connections), status: 200 },
  "GET /api/usage/codex-primary": { body: codexQuota, status: 200 },
  "GET /api/usage/kiro-team": { body: { message: "Kiro quota unavailable" }, status: 200 },
  "GET /api/usage/codex-primary/codex-reset-credits": {
    body: {
      availableCount: 2,
      credits: [
        { status: "available", grantedAt: "2026-09-01T10:00:00Z", expiresAt: "2026-09-10T10:00:00Z" },
        { status: "available", grantedAt: "2026-09-02T10:00:00Z", expiresAt: "2026-09-12T10:00:00Z" },
      ],
    },
    status: 200,
  },
  "POST /api/usage/codex-primary/codex-reset-credits": { body: { ok: true }, status: 200 },
  "PUT /api/providers/codex-primary": { body: codex, status: 200 },
  "PUT /api/providers/kiro-team": { body: kiro, status: 200 },
  "DELETE /api/providers/codex-primary": { body: { ok: true }, status: 200 },
});

// ProviderLimits reads its filter state from the URL query (FILTER_URL_KEYS in
// index.js), not from route params, so the pathname carries the query directly.
const fixture = (routes, query = {}) => ({
  scenario: "default",
  pathname: `/dashboard/usage${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ""}`,
  params: {},
  routes,
});

const meta = {
  title: "Production/usage/Provider limits",
  parameters: {
    layout: "padded",
    storyFixture: fixture(baseRoutes()),
  },
  render: () => <Suspense fallback={<div>Loading…</div>}><ProviderLimits /></Suspense>,
};

export default meta;

export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("owner@example.com")).toBeVisible());
    await expect(canvas.getByText("Kiro AI")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Refresh all" })).toBeEnabled();
  },
};

export const Loading = {
  parameters: {
    storyFixture: fixture({
      ...settingsRoutes(),
      "GET /api/providers/client": () => new Promise(() => {}),
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Loading provider limits...")).toBeVisible();
  },
};

export const Error = {
  parameters: {
    storyFixture: fixture({
      ...baseRoutes([codex]),
      "GET /api/usage/codex-primary": { body: { error: "Quota service unavailable" }, status: 503 },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("Quota service unavailable"));
  },
};

export const ResetDialog = {
  parameters: {
    storyFixture: fixture(baseRoutes()),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("owner@example.com")).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "Use one Codex reset credit. 2 available." }));
    await expect(await within(document.body).findByRole("dialog", { name: "Reset Codex limit?" })).toBeVisible();
  },
};

export const GroupedAccounts = {
  parameters: {
    storyFixture: fixture({
      ...settingsRoutes(),
      "GET /api/proxy-pools": { body: { proxyPools: [] }, status: 200 },
      "GET /api/providers/client": { body: connectionPage([codex, codexSecondary]), status: 200 },
      "GET /api/usage/codex-primary": { body: codexQuota, status: 200 },
      "GET /api/usage/codex-secondary": { body: codexQuota, status: 200 },
    }),
  },
  play: async ({ canvasElement }) => {
    // The merged toggle persists per provider in localStorage; clear it so the
    // story always starts from the default per-account view.
    window.localStorage.removeItem("quotaMergedProviders");
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("2 accounts")).toBeVisible());
    await expect(canvas.getByText("owner@example.com")).toBeVisible();
    await expect(canvas.getByText("second@example.com")).toBeVisible();
    const mergeToggle = canvas.getByRole("switch", { name: "Merge codex quotas across accounts" });
    // Hydration reads localStorage before play runs, so reset the UI too.
    if (mergeToggle.getAttribute("aria-checked") === "true") await userEvent.click(mergeToggle);
    await expect(mergeToggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(mergeToggle);
    await expect(mergeToggle).toHaveAttribute("aria-checked", "true");
  },
};

export const GroupFilters = {
  parameters: {
    storyFixture: fixture(baseRoutes([codex])),
  },
  // ProviderLimits reads its live filter state from window.location.search
  // (index.js:343), which a Storybook fixture cannot own, so this story drives
  // the real user interaction instead of pre-seeding the URL.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("owner@example.com")).toBeVisible();
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Filter quota providers" })).toHaveTextContent("All providers"));
    await userEvent.click(canvas.getByRole("combobox", { name: "Filter quota providers" }));
    const options = within(await within(document.body).findByRole("listbox", { name: "Filter quota providers" }));
    await userEvent.click(options.getByRole("option", { name: "codex" }));
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Filter quota providers" })).toHaveTextContent("codex"));
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Sort Codex quotas by remaining" })).toBeVisible());
  },
};

export const CreditBranches = {
  parameters: {
    storyFixture: fixture(baseRoutes()),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("owner@example.com")).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "View Codex reset credit expiry" }));
    // The modal re-renders while credits load, so re-query each poll instead of
    // holding a node reference that React can replace.
    const body = within(document.body);
    await waitFor(() => expect(body.getByRole("dialog", { name: "Codex Reset Credit Expiry" })).toBeVisible());
    await waitFor(() => expect(body.getByText("2 reset credits")).toBeVisible());
    await waitFor(() => expect(body.getByText("2 available")).toBeVisible());
  },
};
export const DeleteConfirm = {
  parameters: {
    storyFixture: fixture(baseRoutes()),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("owner@example.com")).toBeVisible();
    await userEvent.click((await canvas.findAllByRole("button", { name: "Delete connection" }))[0]);
    await expect(await within(document.body).findByRole("dialog", { name: "Delete connection?" })).toBeVisible();
  },
};
