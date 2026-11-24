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
    const summary = view.getByRole("region", { name: "Provider readiness" });
    await expect(summary).toBeInTheDocument();
    await expect(within(summary).getByText(/Configured native kinds: .*chat/)).toBeInTheDocument();
    await expect(within(summary).getByText(/Saved successful credential validations: 1\./)).toBeInTheDocument();
    await expect(within(summary).getByText("Current authentication").parentElement.querySelector("dd")).toHaveTextContent("UNKNOWN");
    await expect(within(summary).getByText("Actual inference").parentElement.querySelector("dd")).toHaveTextContent("UNKNOWN");
    const evidenceRegion = await view.findByLabelText("Local API readiness evidence");
    await expect(within(evidenceRegion).getByText("Configured native operation kinds: chat.", { exact: false })).toBeInTheDocument();
    await expect(within(evidenceRegion).getByText("Authenticated validation").parentElement.querySelector("dd")).toHaveTextContent("Unknown — no fresh timestamped evidence");
    await expect(within(evidenceRegion).getByText("Actual inference").parentElement.querySelector("dd")).toHaveTextContent("Unknown — no account, model and operation-bound evidence");
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
    const summary = view.getByRole("region", { name: "Provider readiness" });
    await expect(within(summary).getByText("Catalog metadata").parentElement.querySelector("dd")).toHaveTextContent("Not listed");
    await expect(within(summary).getByText("Configured native kinds: none.", { exact: false })).toBeInTheDocument();
    await expect(within(summary).getByText(/Saved successful credential validations: 0\./)).toBeInTheDocument();
    await expect(within(summary).getByText("Current authentication").parentElement.querySelector("dd")).toHaveTextContent("UNKNOWN");
    await expect(within(summary).getByText("Actual inference").parentElement.querySelector("dd")).toHaveTextContent("UNKNOWN");
    const evidenceRegion = await view.findByLabelText("Local API readiness evidence");
    await expect(within(evidenceRegion).getByText("Not listed")).toBeInTheDocument();
    await expect(within(evidenceRegion).getByText(/Configured native operation kinds: none reported\./)).toBeInTheDocument();
    await expect(within(evidenceRegion).getByText("Authenticated validation").parentElement.querySelector("dd")).toHaveTextContent("Unknown — no fresh timestamped evidence");
    await expect(within(evidenceRegion).getByText("Actual inference").parentElement.querySelector("dd")).toHaveTextContent("Unknown — no account, model and operation-bound evidence");
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
