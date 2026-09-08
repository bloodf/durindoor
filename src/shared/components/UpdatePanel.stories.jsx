import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import UpdatePanel from "./UpdatePanel.js";
import { UPDATER_CONFIG } from "@/shared/constants/config";

/**
 * Production — UpdatePanel.
 *
 * Sidebar mounts this panel inside a dimmed overlay; the story reproduces
 * the same wrapper so the panel's surface, progress bar, and manual
 * fallback are visible against the dashboard canvas.
 *
 * The detached updater status endpoint (`http://127.0.0.1:<statusPort>/update/status`)
 * is cross-origin from Storybook's canvas, so it is keyed under
 * `storyFixture.externalFixtures` as a single terminal response (external
 * fixtures are static — no stateful descriptor functions). `/api/version/update`
 * and `/api/version` stay same-origin `routes` entries.
 */

const SURFACE_CLASS = "flex min-h-[480px] items-center justify-center bg-dd-backdrop/80 p-6";

const TRIGGER_CLASS =
  "h-11 min-w-11 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

const INSTALL_CMD = "npm i -g durindoor@latest";

const STATUS_KEY = `GET http://127.0.0.1:${UPDATER_CONFIG.statusPort}/update/status`;
const UPDATE_KEY = "POST /api/version/update";
const VERSION_KEY = "GET /api/version";
const SHUTDOWN_KEY = "POST /api/version/shutdown";

const AUTO_SUCCESS_ROUTES = {
  [UPDATE_KEY]: { body: { ok: true }, status: 202 },
  [VERSION_KEY]: { body: { version: "3.20.0" }, status: 200 },
  [SHUTDOWN_KEY]: { body: { ok: true }, status: 200 },
};

const AUTO_SUCCESS_EXTERNAL = {
  [STATUS_KEY]: {
    body: { done: true, success: true, phase: "done", logTail: ["installed durindoor@3.19.0", "restart scheduled"] },
    status: 200,
  },
};

const AUTO_FAIL_ROUTES = {
  [UPDATE_KEY]: { body: { message: "Updater disabled in this build" }, status: 409 },
};

const MANUAL_ROUTES = {
  [SHUTDOWN_KEY]: { body: { ok: true }, status: 200 },
};

function PanelSurface({ children }) {
  return <div className={SURFACE_CLASS}>{children}</div>;
}

function AutoStory() {
  const [open, setOpen] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        Show update overlay
      </button>
      {open ? (
        <PanelSurface>
          <UpdatePanel currentVersion="3.18.0" latestVersion="3.19.0" installCmd={INSTALL_CMD} onClose={() => setOpen(false)} onReload={() => setReloaded(true)} />
        </PanelSurface>
      ) : null}
      {reloaded ? <p role="status">Dashboard reloaded</p> : null}
    </div>
  );
}

function FailedAutoStory() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        Show failed update
      </button>
      {open ? (
        <PanelSurface>
          <UpdatePanel currentVersion="3.18.0" latestVersion="3.19.0" installCmd={INSTALL_CMD} onClose={() => setOpen(false)} />
        </PanelSurface>
      ) : null}
    </div>
  );
}

function ManualStory() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        Show manual fallback
      </button>
      {open ? (
        <PanelSurface>
          <UpdatePanel currentVersion="3.18.0" latestVersion="3.19.0" installCmd={INSTALL_CMD} onClose={() => setOpen(false)} />
        </PanelSurface>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Production/Shared-Support/UpdatePanel",
  component: UpdatePanel,
  parameters: { layout: "fullscreen" },
};

export default meta;

export const AutoSuccess = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard",
      routes: AUTO_SUCCESS_ROUTES,
      externalFixtures: AUTO_SUCCESS_EXTERNAL,
    },
  },
  render: () => <AutoStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Show update overlay" }));
    const panel = await within(document.body).findByLabelText(/Update .* to v3\.19\.0/);
    expect(within(panel).getByText(/One-click install/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: /Update & Restart/i }));
    await waitFor(() => expect(within(panel).getByText(/Install succeeded/)).toBeInTheDocument());
    expect(within(panel).getByText(/installed durindoor@3\.19\.0/)).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByText("Dashboard reloaded")).toBeVisible());
  },
};

export const AutoFailedFallsBackToManual = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard",
      routes: AUTO_FAIL_ROUTES,
    },
  },
  render: () => <FailedAutoStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Show failed update" }));
    const panel = await within(document.body).findByLabelText(/Update .* to v3\.19\.0/);
    await userEvent.click(within(panel).getByRole("button", { name: /Update & Restart/i }));
    await waitFor(() => expect(within(panel).getByText(/Auto-update unavailable/)).toBeInTheDocument());
    expect(within(panel).getByText(INSTALL_CMD)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Copy & Shutdown/i })).toBeInTheDocument();
  },
};

export const ManualInstallOpensFromIdle = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard",
      routes: MANUAL_ROUTES,
    },
  },
  render: () => <ManualStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Show manual fallback" }));
    const panel = await within(document.body).findByLabelText(/Update .* to v3\.19\.0/);
    await userEvent.click(within(panel).getByRole("button", { name: /Prefer manual install instead/i }));
    expect(within(panel).getByText(INSTALL_CMD)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Copy & Shutdown/i })).toBeInTheDocument();
  },
};
