import React from "react";
import { expect, userEvent, within } from "storybook/test";
import TokenSaverRoute from "./TokenSaverRoute";
import pxpipeMeta, { Empty as PxpipeEmpty, Unavailable as PxpipeUnavailable } from "../pxpipe/PxpipeClient.stories.jsx";

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
const overviewStats = {
  requestsObserved: 78,
  rtk: { bytesSaved: 1824760, requestsWithHits: 55, hits: 183 },
  headroom: {
    tokensSaved: 44820,
    compressed: 43,
    skipped: 11,
    phantomSavings: 2,
    bodyBytesBefore: 1247600,
    bodyBytesAfter: 926400,
    skipReasons: { disabled: 4, "unsupported request": 3, "unsafe input": 2 },
  },
  pxpipe: { tokensSavedEst: 18200, applied: 12, imageCount: 37 },
  totals: { actualBytesSaved: 2141200 },
  dailyPoints: [
    { dateKey: "2026-09-01", actualBytesSaved: 210040 },
    { dateKey: "2026-09-02", actualBytesSaved: 325820 },
    { dateKey: "2026-09-03", actualBytesSaved: 471210 },
    { dateKey: "2026-09-04", actualBytesSaved: 318400 },
  ],
};

const pxpipeStats = {
  windows: {
    last7d: { requests: 112, compressed: 81, bypassed: 31, tokensBeforeEst: 360000, tokensAfterEst: 210000, tokensSavedEst: 150000, savedPct: 42, imagesGenerated: 170, avgCompressionMs: 220, errors: 2 },
    last30d: { requests: 512, compressed: 381, bypassed: 131, tokensBeforeEst: 1600000, tokensAfterEst: 960000, tokensSavedEst: 640000, savedPct: 40, imagesGenerated: 710, avgCompressionMs: 230, errors: 6 },
  },
  recent: [{ ts: "2026-09-28T12:00:00.000Z", provider: "claude", model: "claude-sonnet-4-5", applied: true, tokensBeforeEst: 12000, tokensAfterEst: 7000, tokensSavedEst: 5000, savedPct: 42, durationMs: 220 }],
  timeline: [{ date: "2026-09-01", tokensSavedEst: 4000 }, { date: "2026-09-02", tokensSavedEst: 6200 }, { date: "2026-09-03", tokensSavedEst: 5100 }],
};

const overviewRoutes = {
  "GET /api/settings": { body: { rtkEnabled: true, headroomEnabled: true, headroomUrl: "http://localhost:8787", headroomTimeoutMs: 15000, cavemanEnabled: true, cavemanLevel: "full", ponytailEnabled: true, ponytailLevel: "full", pxpipeEnabled: true, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000, pxpipeAllowedModels: ["claude-sonnet-4-5"] } },
  "PATCH /api/settings": { body: { success: true } },
  "GET /api/headroom/status": { body: { installed: true, running: true, localUrl: true, source: "managed" } },
  "GET /api/headroom/extras": { body: { installed: true, version: "0.4.0", extras: { code: true, ml: false }, available: ["code", "ml"], source: "managed" } },
  "GET /api/token-saver/stream": { body: overviewStats, events: [overviewStats] },
  "GET /api/pxpipe/status": { body: { installed: true, running: true, enabled: true, version: "1.4.0", uptimeMs: 5400000, minChars: 25000 } },
  "GET /api/pxpipe/stats": { body: pxpipeStats },
  "GET /api/pxpipe/logs?limit=50": { body: { events: [{ ts: "2026-09-28T12:00:00.000Z", provider: "claude", model: "claude-sonnet-4-5", applied: true, tokensSavedEst: 5000, imageCount: 2, durationMs: 220 }] } },
  "GET /api/pxpipe/logs?limit=200": { body: { events: [{ reason: "unsupported_model", model: "anthropic/claude-opus-4" }] } },
  "POST /api/pxpipe/health": { body: { healthy: true } },
};

/** Production overview composition: aggregate Token Saver stream plus embedded PXPIPE dashboard. */
export const Overview = {
  args: { view: "overview" },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/token-saver", params: {}, routes: overviewRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("RTK bytes saved")).toBeVisible();
    const review = document.documentElement.dataset.ui === "v5";
    await expect(await canvas.findByRole(review ? "region" : "heading", { name: review ? "PXPIPE status" : "PXPIPE Dashboard", exact: true })).toBeVisible();
    await expect(await canvas.findByText("150.0K")).toBeVisible();
    const usagePeriod = within(canvas.getByRole("radiogroup", { name: review ? "Token Saver period" : "Usage period" }));
    const savingsWindow = within(canvas.getByRole("radiogroup", { name: "Savings time window" }));
    await userEvent.click(usagePeriod.getByRole("radio", { name: "7D" }));
    await expect(usagePeriod.getByRole("radio", { name: "7D" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(savingsWindow.getByRole("radio", { name: "30 days" }));
    await expect(savingsWindow.getByRole("radio", { name: "30 days" })).toHaveAttribute("aria-checked", "true");
    await expect(await canvas.findByText("640.0K")).toBeVisible();
  },
};

const meta = { title: "Production/savers/TokenSaverClient", component: TokenSaverRoute, parameters: { layout: "fullscreen" } };
export default meta;

/** Covers all settings rows, Headroom setup modal, level controls, pxpipe form/chips, and status control private scenarios. */
export const Settings = { args: { view: "settings" }, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/token-saver/settings", params: {}, routes } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Manage" })); const dialog = await within(document.body).findByRole("dialog", { name: /Headroom/ }); await expect(within(dialog).getByRole("textbox", { name: "Proxy URL" })).toBeTruthy(); } };

/** Covers Headroom unavailable and PXPIPE dependency-missing error states without real providers. */
export const UnavailableServices = { args: { view: "settings" }, parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/token-saver/settings", params: {}, routes: { ...routes, "GET /api/headroom/status": { body: { installed: false, running: false, localUrl: true, canStart: false, python: null } }, "GET /api/pxpipe/status": { body: { installed: false, running: false } } } } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText(/PXPIPE dependency missing/)).toBeTruthy(); await userEvent.click(await canvas.findByRole("button", { name: "Setup" })); const dialog = await within(document.body).findByRole("dialog", { name: /Setup Headroom/ }); await expect(within(dialog).getByText(/Python ≥ 3.10 required/)).toBeTruthy(); } };

/** A rejected PATCH cannot alter accepted configuration in any compression family. */
export const RejectedCompressionSettings = {
  args: { view: "settings" },
  parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/token-saver/settings", routes: { ...routes, "PATCH /api/settings": { status: 503, body: { error: "Settings storage unavailable" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const name of ["Enable RTK", "Enable Caveman", "Enable Ponytail", "Enable Headroom"]) {
      const control = await canvas.findByRole("switch", { name });
      const accepted = control.getAttribute("aria-checked");
      await userEvent.click(control);
      await canvas.findByText(new RegExp(`${name.replace("Enable ", "")}: Not saved`));
      await expect(control).toHaveAttribute("aria-checked", accepted);
    }
    await userEvent.click(canvas.getByRole("button", { name: "Manage" }));
    const dialog = within(within(document.body).getByRole("dialog", { name: "Headroom", exact: true }));
    const url = dialog.getByRole("textbox", { name: "Proxy URL" });
    await userEvent.clear(url); await userEvent.type(url, "http://changed.local:8787"); await userEvent.tab();
    await canvas.findByText(/Headroom URL: Not saved/);
    await expect(url).toHaveValue("http://localhost:8787");
  },
};

let rejectedWrite = false;
export const RetryCompressionSave = {
  args: { view: "settings" },
  beforeEach: () => { rejectedWrite = false; },
  parameters: { storyFixture: { pathname: "/dashboard/token-saver/settings", routes: { ...routes, "PATCH /api/settings": () => { if (!rejectedWrite) { rejectedWrite = true; return { status: 503, body: { error: "Temporary write failure" } }; } return { body: { success: true } }; } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("switch", { name: "Enable RTK" });
    await userEvent.click(toggle);
    await userEvent.click(await canvas.findByRole("button", { name: "Retry RTK" }));
    await expect(await canvas.findByText("RTK: Saved")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  },
};

// V5 monitoring dashboard states. Each story switches the production V5 attribute on through the Storybook `ui` global.
const emptyStats = { requestsObserved: 0, rtk: { bytesSaved: 0, requestsWithHits: 0, hits: 0 }, headroom: { tokensSaved: 0, compressed: 0, skipped: 0, phantomSavings: 0, bodyBytesBefore: 0, bodyBytesAfter: 0, skipReasons: {} }, pxpipe: { tokensSavedEst: 0, applied: 0, imageCount: 0 }, totals: { actualBytesSaved: 0 }, dailyPoints: [] };
const dashboardRoutes = {
  ...pxpipeMeta.parameters.storyFixture.routes,
  "GET /api/headroom/status": { body: { installed: true, running: true, localUrl: true, source: "managed" } },
  "GET /api/token-saver/stream": { body: overviewStats, events: [overviewStats] },
};
const v5Dashboard = (extra = {}, scenario = "default") => ({ args: { view: "overview" }, globals: { ui: "v5" }, parameters: { storyFixture: { scenario, pathname: "/dashboard/token-saver", params: {}, routes: { ...dashboardRoutes, ...extra } } } });

/** V5 monitoring dashboard: nine widgets from the aggregate stream and PXPIPE endpoints. */
export const DashboardOverview = {
  ...v5Dashboard(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("1.7 MB")).toBeVisible();
    await expect(await canvas.findByRole("region", { name: "PXPIPE status" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /Compression settings/ })).toHaveAttribute("href", "/dashboard/token-saver/settings");
  },
};
export const Empty = {
  ...v5Dashboard({ ...PxpipeEmpty.parameters.storyFixture.routes, "GET /api/token-saver/stream": { body: emptyStats, events: [emptyStats] } }, "empty"),
  play: async ({ canvasElement }) => { await expect(await within(within(canvasElement).getByRole("region", { name: "Compression overview" })).findByText("No Token Saver events yet")).toBeVisible(); },
};
export const ServiceUnavailable = {
  ...v5Dashboard({
    ...PxpipeUnavailable.parameters.storyFixture.routes,
    "GET /api/token-saver/stream": { body: emptyStats, events: [emptyStats] },
    "GET /api/headroom/status": { body: { ok: false, diagnostic: { code: "NOT_INSTALLED", summary: "Headroom setup needed", fixes: [] } } },
  }, "error"),
  play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByText("Headroom setup needed")).toBeVisible(); },
};
export const LoadingMetrics = {
  ...v5Dashboard({ "GET /api/token-saver/stream": { body: {}, events: [] } }),
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getAllByText("Loading Token Saver metrics")[0]).toBeVisible(); },
};
export const PxpipeInitialLoading = {
  ...v5Dashboard(Object.fromEntries(["GET /api/pxpipe/status", "GET /api/pxpipe/stats", "GET /api/pxpipe/logs?limit=50", "POST /api/pxpipe/health"].map((key) => [key, async () => new Promise(() => {})]))),
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(canvas.queryByText("No transform events yet.")).not.toBeInTheDocument(); await expect(await canvas.findByText("Loading PXPIPE events")).toBeVisible(); },
};
export const PxpipeStatsUnavailable = {
  ...v5Dashboard({ "GET /api/pxpipe/stats": { status: 503, body: { error: "Metrics unavailable" } } }, "error"),
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect((await canvas.findAllByText(/PXPIPE stats could not be refreshed/))[0]).toBeVisible(); await expect(canvas.queryByText("No estimated savings recorded in this period.")).not.toBeInTheDocument(); },
};
let eventReads = 0;
export const PxpipeEventsRetry = {
  ...v5Dashboard({ "GET /api/pxpipe/logs?limit=50": () => ++eventReads === 1 ? { status: 503, body: { error: "Events unavailable" } } : dashboardRoutes["GET /api/pxpipe/logs?limit=50"] }, "error"),
  beforeEach: () => { eventReads = 0; },
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText(/PXPIPE events could not be refreshed/)).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Retry PXPIPE events" })); await expect(await canvas.findByRole("region", { name: "PXPIPE raw event log" })).toBeVisible(); },
};

/** V5 settings view keeps the incumbent compression settings with V5 tokens, pending state and rollback. */
export const V5Settings = { ...Settings, globals: { ui: "v5" } };
export const V5RejectedCompressionSettings = { ...RejectedCompressionSettings, globals: { ui: "v5" } };
export const V5RetryCompressionSave = { ...RetryCompressionSave, globals: { ui: "v5" } };
