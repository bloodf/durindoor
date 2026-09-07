import React, { useState } from "react";
import { expect, fn, spyOn, userEvent, within } from "storybook/test";

import McpGatewayError from "./error";
import McpGatewayPage from "./page.js";

const MCP_GATEWAY_ERROR = new Error("MCP Gateway failed to load");

function McpGatewayErrorHarness() {
  const [retried, setRetried] = useState(false);
  return <><McpGatewayError error={MCP_GATEWAY_ERROR} reset={() => setRetried(true)} />{retried ? <p>Reset requested</p> : null}</>;
}

const INSTANCES = [
  { id: "granola", slug: "granola", kind: "http", transport: "http", url: "https://mcp.granola.ai/mcp", oauth: true, oauthStatus: "connected", enabled: true },
  { id: "jira", slug: "jira-acme", kind: "http", transport: "sse", url: "https://mcp.acme.dev/sse", oauth: false, enabled: true },
  { id: "stale", slug: "legacy", kind: "http", transport: "http", url: "https://legacy.invalid/mcp", oauth: true, oauthStatus: "needs_login", enabled: true },
];
const KEYS = [
  { id: "k1", name: "Cursor laptop", machineId: "ab12cd34-1234-5678-9abc-def012345678", createdAt: "2026-08-21T10:00:00Z" },
  { id: "k2", name: "CI gateway", machineId: null, createdAt: "2026-09-01T15:30:00Z" },
];
const OK = { status: 200, body: { ok: true } };

/**
 * Stateful `storyFixture.routes` matching the central network contract
 * (`setupStoryFixture` / `.storybook/network.js` per
 * plans/002-storybook-coverage.md): per-route handler functions receive a
 * native `Request` object, mutate per-story state for DELETE/PUT, and return
 * `{ status, body }` descriptors. Keys are exact `METHOD path` strings.
 */
function defaultFixture({ instances = INSTANCES, keys = KEYS } = {}) {
  const state = { instances: instances.map((instance) => ({ ...instance })), keys: keys.map((key) => ({ ...key })), grants: new Map([["k1", ["granola", "jira"]], ["k2", []]]) };
  return {
    scenario: "default",
    pathname: "/dashboard/mcp-gateway",
    params: {},
    routes: {
      "GET /api/mcp-gateway/instances": () => ({ status: 200, body: { instances: state.instances } }),
      "GET /api/mcp-gateway/keys": () => ({ status: 200, body: { keys: state.keys } }),
      "POST /api/mcp-gateway/instances": async (request) => {
        const body = await request.json();
        const instance = { ...body, id: body.id || "new", enabled: body.enabled ?? true };
        state.instances.push(instance);
        return { status: 200, body: { instance } };
      },
      "POST /api/mcp-gateway/keys": async (request) => {
        const body = await request.json();
        const key = { id: "k-new", name: body.name, machineId: null, createdAt: "2026-09-06T00:00:00Z" };
        state.keys.push(key);
        return { status: 200, body: { key: { ...key, key: "sk-story-created-key" } } };
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
      "GET /api/mcp-gateway/keys/k1": () => ({ status: 200, body: { id: "k1", grants: state.grants.get("k1") ?? [] } }),
      "PUT /api/mcp-gateway/keys/k1": async (request) => {
        const body = await request.json();
        state.grants.set("k1", body.grants ?? []);
        return OK;
      },
      "DELETE /api/mcp-gateway/keys/k1": () => {
        state.keys = state.keys.filter((key) => key.id !== "k1");
        return OK;
      },
      "GET /api/mcp-gateway/keys/k2": () => ({ status: 200, body: { id: "k2", grants: state.grants.get("k2") ?? [] } }),
      "PUT /api/mcp-gateway/keys/k2": OK,
      "DELETE /api/mcp-gateway/keys/k2": OK,
      "GET /api/mcp-gateway/keys/k1/reveal": () => ({ status: 200, body: { key: "sk-live-revealed" } }),
      "GET /api/mcp-gateway/keys/k2/reveal": () => ({ status: 200, body: { key: "sk-live-revealed" } }),
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

export const DeleteKey = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cursorRow = (await canvas.findByText("Cursor laptop")).closest("article");
    await userEvent.click(within(cursorRow).getByRole("button", { name: "Delete key" }));
    const modal = within(await within(document.body).findByRole("dialog", { name: "Delete gateway key?" }));
    await userEvent.click(modal.getByRole("button", { name: "Delete key" }));
    await expect(canvas.queryByText("Cursor laptop")).not.toBeInTheDocument();
  },
};

export const SaveGrants = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cursorRow = (await canvas.findByText("Cursor laptop")).closest("article");
    await userEvent.click(within(cursorRow).getByRole("button", { name: "Manage grants" }));
    const portal = within(document.body);
    const dialog = within(await portal.findByRole("dialog", { name: "Manage instance grants" }));
    const jira = await dialog.findByRole("checkbox", { name: /jira-acme/ });
    await expect(jira).toBeChecked();
    await userEvent.click(jira);
    await expect(jira).not.toBeChecked();
    await userEvent.click(dialog.getByRole("button", { name: "Save grants" }));
    const updatedRow = (await canvas.findByText("Cursor laptop")).closest("article");
    await userEvent.click(within(updatedRow).getByRole("button", { name: "Manage grants" }));
    const updatedDialog = within(await portal.findByRole("dialog", { name: "Manage instance grants" }));
    await expect(await updatedDialog.findByRole("checkbox", { name: /jira-acme/ })).not.toBeChecked();
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

export const NewKeyKeyboard = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "New key" }));
    const dialog = within(document.body);
    const input = await dialog.findByLabelText("Key name");
    input.focus();
    await userEvent.keyboard("{Enter}");
    await expect(await dialog.findByRole("dialog", { name: "Gateway key created" })).toBeVisible();
  },
};

export const NewKeyFreshMount = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "New key" }));
    const dialog = within(document.body);
    await userEvent.type(await dialog.findByLabelText("Key name"), "Discarded");
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));
    await userEvent.click(canvas.getByRole("button", { name: "New key" }));
    await expect(await dialog.findByLabelText("Key name")).toHaveValue("");
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

export const MobileNewKeyKeyboard = {
  parameters: { storyFixture: defaultFixture(), viewport: { defaultViewport: "mobile1" } },
  render: () => <McpGatewayPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "New key" }));
    const dialog = within(document.body);
    const input = await dialog.findByLabelText("Key name");
    input.focus();
    await userEvent.keyboard("{Enter}");
    await expect(await dialog.findByRole("dialog", { name: "Gateway key created" })).toBeVisible();
  },
};

export const ErrorBoundary = {
  render: () => <McpGatewayErrorHarness />,
  beforeEach: () => {
    const original = console.error;
    const log = spyOn(console, "error").mockImplementation((message, error) => {
      if (message !== "MCP Gateway page error:" || error !== MCP_GATEWAY_ERROR) original(message, error);
    });
    return () => log.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("MCP Gateway failed to load")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(await canvas.findByText("Reset requested")).toBeVisible();
  },
};
