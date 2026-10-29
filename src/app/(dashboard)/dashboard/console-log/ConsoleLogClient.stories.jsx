import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import ConsoleLogClient from "./ConsoleLogClient";

const LINES = [
  "[17:48:00] ℹ️  [BOOT] durindoor gateway listening on :20128",
  "[17:48:01] ℹ️  [HEADROOM] compression proxy online at :11435",
  "[17:48:02] 🟢 → POST gpt-5.5 → codex/gpt-5.5",
  "[17:48:03] 🟢 📊 DONE 812ms · TTFT 210ms · IN 1,204 · OUT 388",
  "[17:48:04] ⚠️  [HEADROOM] compression skipped: payload under threshold",
  "[17:48:05] ❌ [TIER] provider timeout after 30000ms",
  "[17:48:06] [DEBUG] [CACHE] miss for combo default",
  "TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (route.js:12:3)",
];

const STREAMED = [
  "[17:48:07] 🔵 → POST claude-sonnet-5-5 → anthropic/claude-sonnet-5-5",
  "[17:48:09] 🔵 📊 CANCELLED 1200ms · IN 96 · OUT 12",
];

const routes = {
  "GET /api/translator/console-logs": { body: { success: true, logs: LINES } },
  "GET /api/translator/console-logs/stream": { events: [{ type: "init", logs: LINES }, { type: "lines", lines: STREAMED }] },
  "DELETE /api/translator/console-logs": { body: { success: true } },
};

const emptyRoutes = {
  "GET /api/translator/console-logs": { body: { success: true, logs: [] } },
  "GET /api/translator/console-logs/stream": { events: [{ type: "init", logs: [] }] },
};

// Explicit null clears the inherited SSE descriptor during parameter merging.
// The production transport then polls, including while display is paused.
let polls = 0;
const pollingRoutes = {
  "GET /api/translator/console-logs/stream": null,
  "GET /api/translator/console-logs": () => {
    const extra = Array.from({ length: polls }, (_, index) => `[17:49:${String(index % 60).padStart(2, "0")}] 🟣 → POST gpt-5.5 poll ${index + 1}`);
    polls += 1;
    return { body: { success: true, logs: [...LINES, ...extra].slice(-2000) } };
  },
};

const fixture = (fixtureRoutes) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/console-log", routes: fixtureRoutes } });

export default {
  title: "Production/operations/ConsoleLogClient",
  component: ConsoleLogClient,
  parameters: fixture(routes),
  beforeEach: () => {
    polls = 0;
    return () => { polls = 0; };
  },
};

export const Streaming = {
  parameters: fixture(routes),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/CANCELLED 1200ms/);
    await expect(canvas.getByRole("button", { name: /^All\s*10$/ })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Error\s*2$/ })).toBeInTheDocument();
    await expect(canvas.getByText("Streaming")).toBeInTheDocument();
  },
};

export const Filtered = {
  parameters: fixture(routes),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/CANCELLED 1200ms/);
    await userEvent.click(canvas.getByRole("combobox", { name: "Filter by tag" }));
    await userEvent.click(await within(document.body).findByRole("option", { name: "HEADROOM" }));
    await expect(canvas.getByRole("status", { name: "2 of 10 log lines" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /^Warn/ }));
    await userEvent.type(canvas.getByLabelText("Search console logs"), "skipped");
    await expect(canvas.getByText("skipped", { selector: "mark" })).toBeInTheDocument();
    await expect(canvas.getByRole("status", { name: "1 of 10 log lines" })).toBeInTheDocument();
  },
};

export const Paused = {
  parameters: fixture(pollingRoutes),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/listening on :20128/);
    await userEvent.click(canvas.getByRole("button", { name: "Pause" }));
    await expect(canvas.getByText("Paused")).toBeInTheDocument();
    const pill = await canvas.findByText(/^\d+ new$/, {}, { timeout: 5000 });
    await expect(pill).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Resume" })).toBeEnabled();
  },
};

export const ResumeFromPause = {
  parameters: fixture(pollingRoutes),
  play: async ({ canvasElement }) => {
    await Paused.play({ canvasElement });
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Jump to latest" }));
    await waitFor(() => expect(canvas.queryByText(/^\d+ new$/)).not.toBeInTheDocument());
    await expect(canvas.getByText("Streaming")).toBeVisible();
  },
};

export const Empty = {
  parameters: fixture(emptyRoutes),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No console logs yet.")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Copy visible" })).toBeDisabled();
  },
};
