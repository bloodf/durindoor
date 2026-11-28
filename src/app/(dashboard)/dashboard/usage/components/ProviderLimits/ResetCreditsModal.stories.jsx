import React from "react";
import { expect, fn, within } from "storybook/test";

import ResetCreditsModal from "./ResetCreditsModal";

const codexConnection = {
  id: "codex-primary",
  provider: "codex",
  name: "Primary Codex",
  email: "owner@example.com",
  authType: "oauth",
};

const claudeConnection = {
  id: "claude-primary",
  provider: "claude",
  name: "Claude Account",
  email: "claude@example.com",
  authType: "oauth",
};

// Fixed timestamps keep the rendered rows reproducible. The countdown column
// depends on the wall clock, so the play assertions never read it.
const codexCredits = [
  { status: "available", grantedAt: "2026-01-05T10:00:00Z", expiresAt: "2027-01-05T10:00:00Z" },
  { status: "used", grantedAt: "2025-12-05T10:00:00Z", expiresAt: "2026-06-05T10:00:00Z" },
];

// A paused grant and a spent grant both report a fixed status, independent of
// the current date, so the badge text stays deterministic.
const claudeGrants = [
  {
    id: "grant-session",
    label: "Session limit",
    resetsLeft: 2,
    resetsTotal: 3,
    clears: ["five_hour", "seven_day"],
    endsAt: "2027-01-15T10:00:00Z",
    paused: true,
  },
  {
    id: "grant-weekly",
    label: "Weekly limit",
    resetsLeft: 0,
    resetsTotal: 1,
    clears: ["seven_day"],
    endsAt: "2027-01-20T10:00:00Z",
  },
];

const fixture = {
  scenario: "default",
  pathname: "/dashboard/usage",
  params: {},
};

const meta = {
  title: "Production/usage/ResetCreditsModal",
  component: ResetCreditsModal,
  args: {
    resetCreditsState: null,
    setResetCreditsState: fn(),
  },
  parameters: { layout: "padded", storyFixture: fixture },
};

export default meta;

/** Codex reset credit expiry: two credits with their status and expiry. */
export const Open = {
  args: {
    resetCreditsState: {
      connection: codexConnection,
      loading: false,
      error: null,
      data: { kind: "codex", availableCount: 2, credits: codexCredits },
    },
  },
  play: async () => {
    await within(document.body).findByRole("dialog", { name: "Codex Reset Credit Expiry" });
    const view = within(document.body);
    await expect(view.getByText("OpenAI Codex")).toBeInTheDocument();
    await expect(view.getByText("2 reset credits")).toBeInTheDocument();
    await expect(view.getByText("2 available")).toBeInTheDocument();
    await expect(view.getByRole("table", { name: "Codex reset credit expiry" })).toBeInTheDocument();
    await expect(view.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    await expect(view.getByRole("columnheader", { name: "Expires at" })).toBeInTheDocument();
    await expect(view.getByText("available")).toBeInTheDocument();
    await expect(view.getByText("used")).toBeInTheDocument();
  },
};

/** Claude Code limit resets: one grant table with per-grant status and refills. */
export const ClaudeGrants = {
  args: {
    resetCreditsState: {
      connection: claudeConnection,
      loading: false,
      error: null,
      data: { kind: "claude", availableCount: 1, weeklyResetsAt: "2027-01-18T00:00:00Z", grants: claudeGrants },
    },
  },
  play: async () => {
    await within(document.body).findByRole("dialog", { name: "Claude Code Limit Resets" });
    const view = within(document.body);
    await expect(view.getByText("Claude Code")).toBeInTheDocument();
    await expect(view.getByText("1 reset left")).toBeInTheDocument();
    await expect(view.getByRole("table", { name: "Claude Code limit resets" })).toBeInTheDocument();
    await expect(view.getByRole("columnheader", { name: "Left" })).toBeInTheDocument();
    await expect(view.getByText("Session limit")).toBeInTheDocument();
    await expect(view.getByText("Weekly limit")).toBeInTheDocument();
    await expect(view.getByText("paused")).toBeInTheDocument();
    await expect(view.getByText("used")).toBeInTheDocument();
    await expect(view.getByText("2 / 3")).toBeInTheDocument();
    await expect(view.getByText("session + weekly limits")).toBeInTheDocument();
  },
};

/** The request is still in flight: the body shows progress and close is blocked. */
export const Loading = {
  args: {
    resetCreditsState: { connection: codexConnection, loading: true, error: null, data: null },
  },
  play: async () => {
    await within(document.body).findByRole("dialog", { name: "Codex Reset Credit Expiry" });
    const view = within(document.body);
    await expect(view.getByText("Loading reset credits...")).toBeInTheDocument();
    await expect(view.getByRole("button", { name: "Close" })).toBeDisabled();
  },
};

/** A failed request keeps the dialog open and announces the failure. */
export const Error = {
  args: {
    resetCreditsState: {
      connection: codexConnection,
      loading: false,
      error: "Failed to load Codex reset credits",
      data: null,
    },
  },
  play: async () => {
    await within(document.body).findByRole("dialog", { name: "Codex Reset Credit Expiry" });
    const view = within(document.body);
    await expect(view.getByRole("alert")).toHaveTextContent("Failed to load Codex reset credits");
    await expect(view.getByRole("button", { name: "Close" })).toBeEnabled();
  },
};

/** No credits returned: the dialog explains that there is nothing to show. */
export const Empty = {
  args: {
    resetCreditsState: {
      connection: codexConnection,
      loading: false,
      error: null,
      data: { kind: "codex", availableCount: 0, credits: [] },
    },
  },
  play: async () => {
    await within(document.body).findByRole("dialog", { name: "Codex Reset Credit Expiry" });
    const view = within(document.body);
    await expect(view.getByText("No reset credit details returned")).toBeInTheDocument();
    await expect(view.queryByRole("table")).not.toBeInTheDocument();
  },
};
