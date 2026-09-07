import React from "react";
import { expect, userEvent, within } from "storybook/test";
import TokenSaverClient from "./TokenSaverClient";

const routes = {
  "GET /api/settings": { body: { rtkEnabled: true, headroomEnabled: true, headroomUrl: "http://localhost:8787", headroomTimeoutMs: 15000, cavemanEnabled: true, cavemanLevel: "full", ponytailEnabled: true, ponytailLevel: "full", pxpipeEnabled: false, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000, pxpipeAllowedModels: ["claude-fable-5"] } },
  "PATCH /api/settings": { body: { success: true } },
  "GET /api/headroom/status": { body: { installed: true, running: true, localUrl: true, managedPid: 20128, canStart: true, source: "managed" } },
  "GET /api/headroom/extras": { body: { installed: true, version: "0.4.0", extras: { code: true, ml: false }, available: ["code", "ml"], source: "managed" } },
  "POST /api/headroom/extras": { body: { success: true } },
  "POST /api/headroom/start": { body: { success: true } },
  "POST /api/headroom/stop": { body: { success: true } },
  "GET /api/pxpipe/status": { body: { installed: true, running: false, version: "1.2.0", minChars: 25000 } },
  "POST /api/pxpipe/health": { body: { healthy: true, checks: [] } },
  "GET /api/pxpipe/logs": { body: { events: [{ reason: "unsupported_model", model: "anthropic/claude-opus-4" }] } },
  "POST /api/pxpipe/start": { body: { success: true } },
  "POST /api/pxpipe/stop": { body: { success: true } },
  "POST /api/pxpipe/restart": { body: { success: true } },
};
const meta = { title: "Production/savers/TokenSaverClient", component: TokenSaverClient, parameters: { layout: "fullscreen" } };
export default meta;

/** Covers all settings rows, Headroom setup modal, level controls, pxpipe form/chips, and status control private scenarios. */
export const Settings = { args: { view: "settings" }, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/token-saver/settings", params: {}, routes } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Manage" })); const dialog = await within(document.body).findByRole("dialog", { name: /Headroom/ }); await expect(within(dialog).getByRole("textbox", { name: "Proxy URL" })).toBeTruthy(); } };

/** Covers Headroom unavailable and PXPIPE dependency-missing error states without real providers. */
export const UnavailableServices = { args: { view: "settings" }, parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/token-saver/settings", params: {}, routes: { ...routes, "GET /api/headroom/status": { body: { installed: false, running: false, localUrl: true, canStart: false, python: null } }, "GET /api/pxpipe/status": { body: { installed: false, running: false } } } } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText(/PXPIPE dependency missing/)).toBeTruthy(); await userEvent.click(await canvas.findByRole("button", { name: "Setup" })); const dialog = await within(document.body).findByRole("dialog", { name: /Setup Headroom/ }); await expect(within(dialog).getByText(/Python ≥ 3.10 required/)).toBeTruthy(); } };
