import { expect, userEvent, waitFor, within } from "storybook/test";
import PxpipeClient from "./PxpipeClient";

const HISTORY = Array.from({ length: 28 }, (_, index) => ({
  ts: `2026-09-${String(28 - index).padStart(2, "0")}T12:00:00.000Z`,
  provider: "claude",
  model: "claude-sonnet-4-5",
  applied: index % 4 !== 0,
  reason: index % 4 === 0 ? "below_threshold" : undefined,
  tokensBeforeEst: 12000 + index * 100,
  tokensAfterEst: 7000 + index * 100,
  tokensSavedEst: 5000,
  savedPct: 42,
  durationMs: 220,
}));

const EVENTS = Array.from({ length: 28 }, (_, index) => ({
  ts: `2026-09-${String(28 - index).padStart(2, "0")}T12:00:00.000Z`,
  provider: "claude",
  model: "claude-sonnet-4-5",
  applied: true,
  tokensSavedEst: 5000 + index,
  imageCount: 2,
  durationMs: 220,
}));

const WINDOW_FIXTURE = {
  today: { requests: 12, compressed: 8, bypassed: 4, tokensBeforeEst: 36000, tokensAfterEst: 21000, tokensSavedEst: 15000, savedPct: 42, imagesGenerated: 17, avgCompressionMs: 220, errors: 0 },
  yesterday: { requests: 20, compressed: 11, bypassed: 9, tokensBeforeEst: 54000, tokensAfterEst: 31000, tokensSavedEst: 23000, savedPct: 43, imagesGenerated: 20, avgCompressionMs: 240, errors: 1 },
  last7d: { requests: 112, compressed: 81, bypassed: 31, tokensBeforeEst: 360000, tokensAfterEst: 210000, tokensSavedEst: 150000, savedPct: 42, imagesGenerated: 170, avgCompressionMs: 220, errors: 2 },
  last30d: { requests: 512, compressed: 381, bypassed: 131, tokensBeforeEst: 1600000, tokensAfterEst: 960000, tokensSavedEst: 640000, savedPct: 40, imagesGenerated: 710, avgCompressionMs: 230, errors: 6 },
  all: { requests: 1600, compressed: 1180, bypassed: 420, tokensBeforeEst: 5000000, tokensAfterEst: 3000000, tokensSavedEst: 2000000, savedPct: 40, imagesGenerated: 2200, avgCompressionMs: 230, errors: 12 },
};

const routes = {
  "GET /api/pxpipe/status": { body: { installed: true, running: true, enabled: true, version: "1.4.0", uptimeMs: 5400000 } },
  "GET /api/pxpipe/stats": { body: { windows: WINDOW_FIXTURE, recent: HISTORY, timeline: [{ date: "2026-09-01", tokensSavedEst: 4000 }, { date: "2026-09-02", tokensSavedEst: 6200 }, { date: "2026-09-03", tokensSavedEst: 5100 }] } },
  "GET /api/pxpipe/logs?limit=50": { body: { events: EVENTS } },
  "POST /api/pxpipe/health": { body: { healthy: true } },
};

const emptyRoutes = {
  "GET /api/pxpipe/status": { body: { installed: false, running: false, enabled: false } },
  "GET /api/pxpipe/stats": { body: { windows: {}, recent: [], timeline: [] } },
  "GET /api/pxpipe/logs?limit=50": { body: { events: [] } },
  "POST /api/pxpipe/health": { body: { healthy: false } },
};

const unavailableRoutes = {
  ...emptyRoutes,
  "GET /api/pxpipe/status": { status: 503, body: { error: "PXPIPE daemon is not reachable" } },
};

// Deterministically "loading" by never resolving the four endpoints.
const pendingRoutes = {
  "GET /api/pxpipe/status": async () => new Promise(() => {}),
  "GET /api/pxpipe/stats": async () => new Promise(() => {}),
  "GET /api/pxpipe/logs?limit=50": async () => new Promise(() => {}),
  "POST /api/pxpipe/health": async () => new Promise(() => {}),
};

export default {
  title: "Production/pxpipe/PxpipeClient",
  component: PxpipeClient,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/pxpipe", routes } },
};

export const Populated = {};

export const Empty = {
  parameters: { storyFixture: { scenario: "empty", pathname: "/dashboard/pxpipe", routes: emptyRoutes } },
};

export const Unavailable = {
  parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/pxpipe", routes: unavailableRoutes } },
};
export const Loading = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/pxpipe", routes: pendingRoutes } },
};

export const KeyboardPagingAndRange = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/pxpipe", routes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("PXPIPE Dashboard");
    const sevenDays = canvas.getByRole("radio", { name: "7 days" });
    sevenDays.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "30 days" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getAllByRole("button", { name: "Next page" })[0]);
    await expect(canvas.getAllByRole("button", { name: "Page 2" })[0]).toBeInTheDocument();
    // The page paginates two tables, so each renders its own rows-per-page
    // control (Pagination.jsx native select). Drive the first one.
    await userEvent.selectOptions(canvas.getAllByRole("combobox", { name: "Rows per page" })[0], "50");
    await waitFor(() => expect(canvas.getAllByRole("button", { name: "Page 1" })[0]).toBeInTheDocument());
  },
};

export const RTL = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/pxpipe", routes, locale: "ar" } },
};
export const MobileViewport = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/pxpipe", routes },
    viewport: { defaultViewport: "mobile1" },
  },
};
