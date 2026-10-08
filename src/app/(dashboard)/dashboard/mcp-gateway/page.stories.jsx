import React, { useState } from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";

import McpGatewayError from "./error";
import McpGatewayPage from "./page.js";

const MCP_GATEWAY_ERROR = new Error("MCP Gateway failed to load");

function McpGatewayErrorHarness() {
  const [retried, setRetried] = useState(false);
  return retried
    ? <p>Reset requested</p>
    : <McpGatewayError error={MCP_GATEWAY_ERROR} reset={() => setRetried(true)} />;
}

const INSTANCES = [
  { id: "granola", slug: "granola", kind: "http", transport: "http", url: "https://mcp.granola.ai/mcp", oauth: true, oauthStatus: "connected", enabled: true },
  { id: "jira", slug: "jira-acme", kind: "http", transport: "sse", url: "https://mcp.acme.dev/sse", oauth: false, enabled: true },
  { id: "stale", slug: "legacy", kind: "http", transport: "http", url: "https://legacy.invalid/mcp", oauth: true, oauthStatus: "needs_login", enabled: true },
];
const OK = { status: 200, body: { ok: true } };

/**
 * Stateful `storyFixture.routes` matching the central network contract
 * (`setupStoryFixture` / `.storybook/network.js` per
 * plans/002-storybook-coverage.md): per-route handler functions receive a
 * native `Request` object, mutate per-story state for DELETE/PUT, and return
 * `{ status, body }` descriptors. Keys are exact `METHOD path` strings.
 */
function defaultFixture({ instances = INSTANCES } = {}) {
  const initialState = structuredClone({ instances });
  let state;
  const reset = () => { state = structuredClone(initialState); };
  reset();
  return {
    scenario: "default",
    pathname: "/dashboard/mcp-gateway",
    params: {},
    reset,
    routes: {
      "GET /api/mcp-gateway/instances": () => ({ status: 200, body: { instances: state.instances } }),
      "POST /api/mcp-gateway/instances": async (request) => {
        const body = await request.json();
        const instance = { ...body, id: body.id || "new", enabled: body.enabled ?? true };
        state.instances.push(instance);
        return { status: 200, body: { instance } };
      },
      "PUT /api/mcp-gateway/instances/granola": async (request) => {
        const body = await request.json();
        state.instances = state.instances.map((instance) => (instance.id === "granola" ? { ...instance, ...body } : instance));
        return OK;
      },
      "PUT /api/mcp-gateway/instances/jira": async (request) => {
        const body = await request.json();
        state.instances = state.instances.map((instance) => (instance.id === "jira" ? { ...instance, ...body } : instance));
        return OK;
      },
      "PUT /api/mcp-gateway/instances/fs": OK,
      "PUT /api/mcp-gateway/instances/stale": OK,
      "DELETE /api/mcp-gateway/instances/granola": () => {
        state.instances = state.instances.filter((instance) => instance.id !== "granola");
        return OK;
      },
      "DELETE /api/mcp-gateway/instances/jira": () => {
        state.instances = state.instances.filter((instance) => instance.id !== "jira");
        return OK;
      },
      "DELETE /api/mcp-gateway/instances/fs": OK,
      "DELETE /api/mcp-gateway/instances/stale": OK,
      "POST /api/mcp-gateway/instances/granola/test": () => ({ status: 200, body: { ok: true, toolCount: 6, sample: [{ name: "fetch" }, { name: "search" }] } }),
      "POST /api/mcp-gateway/instances/jira/test": () => ({ status: 200, body: { ok: true, toolCount: 6, sample: [{ name: "fetch" }, { name: "search" }] } }),
      "POST /api/mcp-gateway/instances/fs/test": () => ({ status: 200, body: { ok: true, toolCount: 6, sample: [{ name: "fetch" }, { name: "search" }] } }),
      "POST /api/mcp-gateway/instances/stale/test": () => ({ status: 502, body: { ok: false, error: "401 requires re-login" } }),
      "GET /api/mcp-gateway/oauth/stale/authorize": () => ({ status: 200, body: { url: "https://oauth.invalid/authorize", state: "story-state" } }),
    },
  };
}

const meta = {
  title: "Durin DS/Production Pages/MCP Gateway",
  component: McpGatewayPage,
  parameters: { layout: "fullscreen" },
  // Parameters retain route closures across A/B/A navigation; reset their data
  // before render and again on disposal, not just the fetch/EventSource boundary.
  beforeEach: ({ parameters }) => {
    const reset = parameters.storyFixture?.reset;
    if (!reset) return;
    reset();
    return reset;
  },
};
export default meta;

export const Default = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("MCP Gateway")).toBeVisible();
    const granolaRow = (await canvas.findByText("granola")).closest("article");
    await userEvent.click(within(granolaRow).getByRole("button", { name: "Test" }));
    const result = await within(granolaRow).findByRole("status");
    await expect(result).toHaveTextContent("6 tools discovered");
    await expect(result).toHaveTextContent("Sample: fetch, search");
  },
};

export const DeleteInstance = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Delete jira-acme" }));
    const dialog = within(document.body);
    await expect(await dialog.findByRole("dialog", { name: "Delete instance?" })).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Delete instance" }));
    await expect(canvas.queryByText("jira-acme")).not.toBeInTheDocument();
  },
};


export const OAuthLoginPopupBoundary = {
  parameters: { storyFixture: defaultFixture() },
  args: { openPopup: fn(() => null) },
  render: (args) => <McpGatewayPage {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Login" }));
    await expect(args.openPopup).toHaveBeenCalledWith("https://oauth.invalid/authorize", "_blank");
  },
};


export const CreateInstance = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "New instance" }));
    const portal = within(document.body);
    const dialog = within(await portal.findByRole("dialog", { name: "New instance" }));
    const slug = await dialog.findByRole("textbox", { name: "Slug", exact: true });
    await userEvent.clear(slug);
    await userEvent.type(slug, "story-search");
    await userEvent.type(await dialog.findByRole("textbox", { name: "URL", exact: true }), "https://story.invalid/mcp");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("story-search")).toBeVisible();
    await expect(portal.queryByRole("dialog", { name: "New instance" })).not.toBeInTheDocument();
  },
};

/** Keep the actual custom-create modal unsubmitted for retained visual coverage. */
export const RetainedCreateInstance = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "New instance" }));
    const portal = within(canvasElement.ownerDocument.body);
    const modal = await portal.findByRole("dialog", { name: "New instance" });
    const dialog = within(modal);
    const slug = dialog.getByRole("textbox", { name: "Slug", exact: true });
    const url = dialog.getByRole("textbox", { name: "URL", exact: true });
    await waitFor(() => {
      expect(dialog.getByRole("heading", { name: "New instance", exact: true })).toBeVisible();
      expect(slug).toBeVisible();
      expect(url).toBeVisible();
    });
    await userEvent.click(dialog.getByRole("combobox", { name: "Server preset", exact: true }));
    await userEvent.click(await portal.findByRole("option", { name: /^Custom\b/ }));
    await userEvent.clear(slug);
    await userEvent.type(slug, "story-search");
    await userEvent.clear(url);
    await userEvent.type(url, "https://story.invalid/mcp");
    await expect(slug).toHaveValue("story-search");
    await expect(url).toHaveValue("https://story.invalid/mcp");
    await expect(dialog.getByText("Server preset", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Custom", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await expect(modal).toBeVisible();
    await expect(canvas.queryByText("story-search", { exact: true })).not.toBeInTheDocument();
  },
};

export const SelectServerPreset = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "New instance" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: "New instance" }));
    await userEvent.click(dialog.getByRole("combobox", { name: "Server preset" }));
    await userEvent.click(await within(document.body).findByRole("option", { name: /Notion/ }));
    await expect(dialog.getByRole("textbox", { name: "URL", exact: true })).toHaveValue("https://mcp.notion.com/mcp");
    await expect(dialog.getByRole("switch", { name: "Requires OAuth" })).toBeChecked();
  },
};

export const EditInstance = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const jiraRow = (await canvas.findByText("jira-acme")).closest("article");
    await userEvent.click(within(jiraRow).getByRole("button", { name: "Edit jira-acme" }));
    const portal = within(document.body);
    const dialog = within(await portal.findByRole("dialog", { name: "Edit instance" }));
    const slug = await dialog.findByRole("textbox", { name: "Slug", exact: true });
    await userEvent.clear(slug);
    await userEvent.type(slug, "jira-story");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(canvas.queryByText("jira-acme")).not.toBeInTheDocument();
    await expect(await canvas.findByText("jira-story")).toBeVisible();
  },
};

export const ToggleInstance = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const granolaRow = (await canvas.findByText("granola")).closest("article");
    await userEvent.click(within(granolaRow).getByRole("switch", { name: "Disable instance" }));
    const updatedGranolaRow = (await canvas.findByText("granola")).closest("article");
    await expect(await within(updatedGranolaRow).findByRole("switch", { name: "Enable instance" })).toBeVisible();
  },
};


export const FailedTestRequiresLogin = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const staleRow = (await canvas.findByText("legacy")).closest("article");
    await userEvent.click(within(staleRow).getByRole("button", { name: "Test" }));
    await expect(await within(staleRow).findByRole("status")).toHaveTextContent("Test failed: 401 requires re-login");
    await expect(within(staleRow).getByRole("button", { name: "Login" })).toBeVisible();
  },
};

export const EmptyInstances = {
  parameters: { storyFixture: defaultFixture({ instances: [] }) },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No instances yet")).toBeVisible();
  },
};

export const ErrorBoundary = {
  render: () => <McpGatewayErrorHarness />,
  beforeEach: () => {
    const original = console.error;
    const log = spyOn(console, "error").mockImplementation((...args) => {
      if (args.length !== 2 || args[0] !== "MCP Gateway page error:" || args[1] !== MCP_GATEWAY_ERROR) original(...args);
    });
    return () => log.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("MCP Gateway failed to load")).toBeVisible();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith("MCP Gateway page error:", MCP_GATEWAY_ERROR));
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(await canvas.findByText("Reset requested")).toBeVisible();
    await expect(canvas.queryByText("MCP Gateway failed to load")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  },
};

/** Retain the actual instances boundary/view for capture; reset has its own story. */
export const RetainedErrorBoundary = {
  render: ErrorBoundary.render,
  beforeEach: ErrorBoundary.beforeEach,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("MCP Gateway failed to load")).toBeVisible();
    await expect(canvas.getByText("This usually happens during initial hydration or when the dashboard API is unreachable. Try again to reload the page.")).toBeVisible();
    await expect(canvas.getByText("If the error persists, the dashboard server logs may include more detail.")).toBeVisible();
    const retry = canvas.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(canvas.queryByText("Reset requested")).not.toBeInTheDocument();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith("MCP Gateway page error:", MCP_GATEWAY_ERROR));
  },
};
