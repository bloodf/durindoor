import React, { useState } from "react";
import { expect, spyOn, userEvent, within } from "storybook/test";

import McpGatewayKeysError from "./error";
import McpGatewayKeysPage from "./page.js";

const MCP_GATEWAY_KEYS_ERROR = new Error("MCP Gateway keys failed to load");

function McpGatewayKeysErrorHarness() {
  const [retried, setRetried] = useState(false);
  return <><McpGatewayKeysError error={MCP_GATEWAY_KEYS_ERROR} reset={() => setRetried(true)} />{retried ? <p>Reset requested</p> : null}</>;
}

const INSTANCES = [
  { id: "granola", slug: "granola", kind: "http", transport: "http", url: "https://mcp.granola.ai/mcp", oauth: true, oauthStatus: "connected", enabled: true },
  { id: "jira", slug: "jira-acme", kind: "http", transport: "sse", url: "https://mcp.acme.dev/sse", oauth: false, enabled: true },
];
const KEYS = [
  { id: "k1", name: "Cursor laptop", machineId: "ab12cd34-1234-5678-9abc-def012345678", createdAt: "2026-08-21T10:00:00Z" },
  { id: "k2", name: "CI gateway", machineId: null, createdAt: "2026-09-01T15:30:00Z" },
];
const OK = { status: 200, body: { ok: true } };

/**
 * Same stateful `storyFixture.routes` contract as the instances page. The keys
 * page fetches instances too — the grants modal lists them — so the instance
 * route is served here even though no instance section is rendered.
 */
function defaultFixture({ instances = INSTANCES, keys = KEYS } = {}) {
  const state = { instances: instances.map((instance) => ({ ...instance })), keys: keys.map((key) => ({ ...key })), grants: new Map([["k1", ["granola", "jira"]], ["k2", []]]) };
  return {
    scenario: "default",
    pathname: "/dashboard/mcp-gateway/keys",
    params: {},
    routes: {
      "GET /api/mcp-gateway/instances": () => ({ status: 200, body: { instances: state.instances } }),
      "GET /api/mcp-gateway/keys": () => ({ status: 200, body: { keys: state.keys } }),
      "POST /api/mcp-gateway/keys": async (request) => {
        const body = await request.json();
        const key = { id: `k${state.keys.length + 1}`, name: body.name ?? null, machineId: null, createdAt: "2026-09-15T00:00:00Z" };
        state.keys = [...state.keys, key];
        state.grants.set(key.id, []);
        return { status: 200, body: { key: { ...key, key: "sk-story-gateway-key" } } };
      },
      "GET /api/mcp-gateway/keys/k1": () => ({ status: 200, body: { grants: state.grants.get("k1") ?? [] } }),
      "GET /api/mcp-gateway/keys/k2": () => ({ status: 200, body: { grants: state.grants.get("k2") ?? [] } }),
      "PUT /api/mcp-gateway/keys/k1": async (request) => {
        const body = await request.json();
        state.grants.set("k1", body.grants ?? []);
        return OK;
      },
      "DELETE /api/mcp-gateway/keys/k1": () => {
        state.keys = state.keys.filter((key) => key.id !== "k1");
        return OK;
      },
      "GET /api/mcp-gateway/keys/k1/reveal": () => ({ status: 200, body: { key: "sk-story-revealed" } }),
    },
  };
}

const meta = {
  title: "Durin DS/Production Pages/MCP Gateway Keys",
  component: McpGatewayKeysPage,
  parameters: { layout: "fullscreen" },
};
export default meta;

export const Default = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayKeysPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Gateway Keys")).toBeVisible();
    await expect(await canvas.findByText("Cursor laptop")).toBeVisible();
    // Instances are fetched for the grants picker, never rendered as a section.
    await expect(canvas.queryByText("No instances yet")).not.toBeInTheDocument();
  },
};

export const DeleteKey = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayKeysPage />,
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
  render: () => <McpGatewayKeysPage />,
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

export const NewKeyKeyboard = {
  parameters: { storyFixture: defaultFixture() },
  render: () => <McpGatewayKeysPage />,
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
  render: () => <McpGatewayKeysPage />,
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

export const MobileNewKeyKeyboard = {
  parameters: { storyFixture: defaultFixture(), viewport: { defaultViewport: "mobile1" } },
  render: () => <McpGatewayKeysPage />,
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
  render: () => <McpGatewayKeysErrorHarness />,
  beforeEach: () => {
    const original = console.error;
    const log = spyOn(console, "error").mockImplementation((message, error) => {
      if (message !== "MCP Gateway keys page error:" || error !== MCP_GATEWAY_KEYS_ERROR) original(message, error);
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
