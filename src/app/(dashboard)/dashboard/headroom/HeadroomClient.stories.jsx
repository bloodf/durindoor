import React from "react";
import { expect, userEvent, within } from "storybook/test";
import HeadroomClient from "./HeadroomClient";

const headroomStats = {
  windows: {
    today: { requests: 48, compressed: 31, bypassed: 17, tokensSaved: 18420, tokensBefore: 56320, savedPct: 32.7, errors: 1, avgCompressionMs: 248 },
    yesterday: { requests: 68, compressed: 42, bypassed: 26, tokensSaved: 24810, tokensBefore: 72400, savedPct: 34.3, errors: 0, avgCompressionMs: 236 },
    last7d: { requests: 412, compressed: 267, bypassed: 145, tokensSaved: 173920, tokensBefore: 533900, savedPct: 32.6, errors: 3, avgCompressionMs: 244 },
    last30d: { requests: 1884, compressed: 1201, bypassed: 683, tokensSaved: 774100, tokensBefore: 2365900, savedPct: 32.7, errors: 8, avgCompressionMs: 251 },
    all: { requests: 2971, compressed: 1904, bypassed: 1067, tokensSaved: 1194200, tokensBefore: 3652300, savedPct: 32.7, errors: 14, avgCompressionMs: 249 },
  },
  timeline: [{ date: "2026-08-30", tokensSaved: 18620 }, { date: "2026-08-31", tokensSaved: 24290 }, { date: "2026-09-01", tokensSaved: 21850 }, { date: "2026-09-02", tokensSaved: 31420 }, { date: "2026-09-03", tokensSaved: 26810 }, { date: "2026-09-04", tokensSaved: 33340 }],
  recent: [{ ts: "2026-09-04T14:10:00.000Z", provider: "anthropic", model: "claude-sonnet-4", applied: true, tokensBefore: 12442, tokensSaved: 4038 }, { ts: "2026-09-04T13:44:00.000Z", provider: "openai", model: "gpt-5", applied: false, reason: "skipped", tokensBefore: 8220, tokensSaved: 0 }, { ts: "2026-09-04T13:08:00.000Z", provider: "anthropic", model: "claude-opus-4", applied: false, reason: "request_failed: timeout", tokensBefore: 16180, tokensSaved: 0 }],
};
const routes = {
  "GET /api/settings": { body: { headroomEnabled: true, headroomCompressUserMessages: false } },
  "PATCH /api/settings": { body: { success: true } },
  "GET /api/headroom/status": { body: { installed: true, running: true } },
  "GET /api/headroom/stats": { body: headroomStats },
};

const meta = { title: "Production/savers/HeadroomClient", component: HeadroomClient, parameters: { layout: "fullscreen" } };
export default meta;

/** Covers settings toggles, period tabs, chart, and client-paged event table against route fixtures. */
export const RunningWithEvents = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/headroom", params: {}, routes } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText("Running")).toBeTruthy(); await userEvent.click(canvas.getByRole("tab", { name: "30 days" })); await expect(canvas.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true"); await expect(await canvas.findByText("774.1K")).toBeTruthy(); await userEvent.click(canvas.getByLabelText("Compress user messages")); await expect(canvas.getByLabelText("Compress user messages")).toHaveAttribute("aria-checked", "true"); const events = await canvas.findByRole("region", { name: "Recent Headroom compression events rows" }); await expect(await within(events).findByText(/claude-sonnet-4/)).toBeTruthy(); await expect(within(events).getByRole("row", { name: /claude-sonnet-4/ })).toHaveTextContent("Compressed"); } };

/** Covers service diagnostic state while retaining settings controls and no-event DataTable state. */
export const SetupDiagnostic = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/headroom", params: {}, routes: { ...routes, "GET /api/headroom/status": { body: { ok: false, diagnostic: { code: "NOT_INSTALLED", summary: "Headroom is not installed", fixes: [] } } }, "GET /api/headroom/stats": { body: { windows: {}, timeline: [], recent: [] } } } } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); const diagnostic = await canvas.findByRole("alert"); await expect(diagnostic).toHaveTextContent("Headroom is not installed"); await expect(await canvas.findByLabelText("Enable Headroom")).toHaveAttribute("disabled"); const events = await canvas.findByRole("region", { name: "Recent Headroom compression events rows" }); await expect(within(events).getByText("No events recorded")).toBeTruthy(); } };
