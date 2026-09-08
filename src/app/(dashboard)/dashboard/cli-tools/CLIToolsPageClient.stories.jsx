import React from "react";
import { within, expect } from "storybook/test";
import CLIToolsPageClient from "./CLIToolsPageClient";

const defaultRoutes = {
  "GET /api/cli-tools/all-statuses": {
    body: {
      claude: { installed: true, has9Router: true },
      codex: { installed: true, has9Router: false },
    },
  },
};

const errorRoutes = {
  "GET /api/cli-tools/all-statuses": async () => ({ status: 500, body: { error: "upstream" } }),
};

export default {
  title: "Durin DS/Production Pages/cli-tools/CLIToolsPageClient",
  component: CLIToolsPageClient,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", params: {}, routes: defaultRoutes } },
};

export const Catalog = { args: { machineId: "story-machine" } };

export const CatalogVisible = {
  args: { machineId: "story-machine" },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("heading", { name: "CLI Tools" })).toBeInTheDocument();
    const region = body.getByRole("region", { name: "CLI tools" });
    expect(within(region).getAllByRole("link").length).toBeGreaterThan(0);
  },
};

export const MitmSectionVisible = {
  args: { machineId: "story-machine" },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("heading", { name: "MITM Tools" })).toBeInTheDocument();
    const mitmRegion = body.getByRole("region", { name: "MITM tools" });
    expect(within(mitmRegion).getAllByRole("link").length).toBeGreaterThan(0);
  },
};

export const FetchError = {
  args: { machineId: "story-machine" },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", params: {}, routes: errorRoutes } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("alert")).toHaveTextContent(/could not load tool statuses/i);
    expect(body.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  },
};
