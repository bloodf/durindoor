import React from "react";
import { expect, within } from "storybook/test";

import NativeProviderReadiness from "./NativeProviderReadiness";

const evidence = { catalog: "LISTED", chatDispatch: "CONFIGURED", nativeKinds: ["chat"] };
const fixture = (providerId, route) => ({
  scenario: "default",
  pathname: `/dashboard/providers/${providerId}`,
  params: { id: providerId },
  routes: { [`GET /api/providers/${providerId}/readiness`]: route },
});

const meta = {
  title: "Production/providers/NativeProviderReadiness",
  component: NativeProviderReadiness,
  args: {
    providerId: "openai",
    connections: [{ provider: "openai", testStatus: "active" }],
  },
  parameters: {
    layout: "padded",
    storyFixture: fixture("openai", { body: evidence }),
  },
};

export default meta;

/** Local readiness is loaded. Authentication and inference stay UNKNOWN. */
export const Loaded = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole("region", { name: "Provider readiness" })).toBeInTheDocument();
    await expect(await view.findByText("Listed")).toBeInTheDocument();
    await expect(view.getByText("Saved successful credential validations: 1")).toBeInTheDocument();
    await expect(view.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    await expect(await view.findByLabelText("Local API readiness evidence")).toBeInTheDocument();
  },
};

/** No saved connection. The local evidence lists nothing. */
export const Empty = {
  args: { providerId: "fixture-empty", connections: [] },
  parameters: {
    storyFixture: fixture("fixture-empty", { body: { catalog: "NOT_LISTED", chatDispatch: "UNKNOWN", nativeKinds: [] } }),
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText("Not listed")).toBeInTheDocument();
    await expect(view.getByText("No dedicated native route configured")).toBeInTheDocument();
    await expect(view.getByText("Saved successful credential validations: 0")).toBeInTheDocument();
    await expect(await view.findByText(/none reported/)).toBeInTheDocument();
  },
};

/** The local readiness request has not returned. */
export const Loading = {
  parameters: {
    storyFixture: fixture("openai", () => new Promise(() => {})),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Loading local readiness evidence…");
  },
};

/** The local readiness request failed. The summary stays on screen. */
export const Error = {
  parameters: {
    storyFixture: fixture("openai", { status: 503, body: { error: "Readiness unavailable" } }),
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole("region", { name: "Provider readiness" })).toBeInTheDocument();
    await expect(await view.findByText("Readiness evidence unavailable. Catalog, dispatch, authentication and inference are unknown.")).toBeInTheDocument();
  },
};
