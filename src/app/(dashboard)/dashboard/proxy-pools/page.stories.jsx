import React from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";
import ProxyPoolsPage from "./page";
import { useNotificationStore } from "@/store/notificationStore";

const initialPool = { id: "pool-1", name: "Office relay", proxyUrl: "http://proxy.example:8080", noProxy: "localhost", isActive: true, testStatus: "active", boundConnectionCount: 2, lastTestedAt: "2026-09-05T00:00:00.000Z", type: "cloudflare" };

// Each story gets its own isolated in-memory pool list so mutations in one
// play function never leak into another story's fixture.
function buildStatefulRoutes(seed = [initialPool]) {
  const state = { pools: seed.map((p) => ({ ...p })) };
  return {
    "GET /api/proxy-pools": () => ({ body: { proxyPools: state.pools.map((p) => ({ ...p })) } }),
    "POST /api/proxy-pools/pool-1/test": () => ({ body: { ok: true } }),
    "PUT /api/proxy-pools/pool-1": async (request) => {
      const patch = await request.json();
      state.pools = state.pools.map((p) => (p.id === "pool-1" ? { ...p, ...patch } : p));
      return { body: { success: true } };
    },
    "DELETE /api/proxy-pools/pool-1": () => {
      state.pools = state.pools.filter((p) => p.id !== "pool-1");
      return { body: { success: true } };
    },
    "POST /api/proxy-pools": async (request) => {
      const payload = await request.json();
      const id = `pool-${state.pools.length + 1}`;
      state.pools.push({ id, name: payload.name, proxyUrl: payload.proxyUrl, isActive: true, testStatus: "active", boundConnectionCount: 0, lastTestedAt: null });
      return { body: { id, success: true } };
    },
    "POST /api/proxy-pools/cloudflare-deploy": () => ({ body: { deployUrl: "https://fixture.workers.dev" } }),
    "POST /api/proxy-pools/vercel-deploy": () => ({ body: { deployUrl: "https://fixture.vercel.app" } }),
  };
}

const baseRoutes = buildStatefulRoutes();
const emptyRoutes = buildStatefulRoutes([]);
const failedCreateRoutes = { ...buildStatefulRoutes(), "POST /api/proxy-pools": () => ({ status: 400, body: { error: "Proxy endpoint rejected" } }) };
const failedDeleteRoutes = { ...buildStatefulRoutes(), "DELETE /api/proxy-pools/pool-1": () => ({ status: 500, body: { error: "Cannot delete right now" } }) };

const pendingCreateRoutes = { ...buildStatefulRoutes(), "POST /api/proxy-pools": () => new Promise(() => {}) };
const pendingDeleteRoutes = { ...buildStatefulRoutes(), "DELETE /api/proxy-pools/pool-1": () => new Promise(() => {}) };
const deadProxyRoutes = { ...buildStatefulRoutes(), "POST /api/proxy-pools/pool-1/test": () => ({ body: { ok: false } }) };
function StoryNotifications() {
  const notifications = useNotificationStore((state) => state.notifications);
  return <>{notifications.map((notification) => <p key={notification.id}>{notification.message}</p>)}</>;
}

export default { title: "Production/operations/ProxyPoolsPage", component: ProxyPoolsPage, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: baseRoutes } } };
export const Populated = {};
export const Empty = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: emptyRoutes } } };
export const OpenCreateDialog = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Add proxy pool" })); await expect(await within(document.body).findByRole("dialog", { name: /Add proxy pool/i })).toBeInTheDocument(); } };
export const CreateSuccess = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: buildStatefulRoutes() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Add proxy pool" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: /Add proxy pool/i }));
    await userEvent.type(dialog.getByLabelText("Name"), "Backup relay");
    await userEvent.type(dialog.getByLabelText("Proxy URL"), "http://backup.example:8080");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Backup relay")).toBeInTheDocument();
  },
};
export const EditSuccess = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: buildStatefulRoutes() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Edit Office relay/i }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: /Edit proxy pool/i }));
    const nameField = dialog.getByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Office relay v2");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Office relay v2")).toBeInTheDocument();
    await expect(canvas.queryByText("Office relay", { exact: true })).not.toBeInTheDocument();
  },
};
export const DeleteSuccess = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: buildStatefulRoutes() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Delete Office relay/i }));
    const confirm = within(await within(document.body).findByRole("dialog", { name: "Delete Proxy Pool" }));
    await userEvent.click(confirm.getByRole("button", { name: "Delete proxy pool" }));
    await waitFor(() => expect(within(document.body).queryByText("Office relay")).not.toBeInTheDocument());
  },
};
export const DisableDeadProxies = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: deadProxyRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Health check" }));
    const confirm = within(await within(document.body).findByRole("dialog", { name: "Disable Dead Proxies" }));
    await expect(confirm.getByRole("button", { name: "Disable dead proxies" })).toBeInTheDocument();
    await expect(confirm.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  },
};
export const CreateError = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: failedCreateRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Add proxy pool" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: /Add proxy pool/i }));
    await userEvent.type(dialog.getByLabelText("Name"), "Rejected relay");
    await userEvent.type(dialog.getByLabelText("Proxy URL"), "http://rejected.example");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(await within(document.body).findByRole("dialog", { name: /Add proxy pool/i })).toBeInTheDocument();
    await expect(await within(document.body).findByText("Proxy endpoint rejected")).toBeVisible();
  },
};
export const DeleteError = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: failedDeleteRoutes } },
  render: () => <><ProxyPoolsPage /><StoryNotifications /></>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Delete Office relay/i }));
    const confirm = within(await within(document.body).findByRole("dialog", { name: "Delete Proxy Pool" }));
    await userEvent.click(confirm.getByRole("button", { name: "Delete proxy pool" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "Delete Proxy Pool" })).not.toBeInTheDocument());
    await expect(canvas.findByText("Cannot delete right now")).resolves.toBeInTheDocument();
  },
};
export const CreatePending = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: pendingCreateRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Add proxy pool" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: /Add proxy pool/i }));
    await userEvent.type(dialog.getByLabelText("Name"), "Pending relay");
    await userEvent.type(dialog.getByLabelText("Proxy URL"), "http://pending.example");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Creating…" })).toBeDisabled();
  },
};
export const DeletePending = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/proxy-pools", routes: pendingDeleteRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Delete Office relay/i }));
    const confirm = within(await within(document.body).findByRole("dialog", { name: "Delete Proxy Pool" }));
    await userEvent.click(confirm.getByRole("button", { name: "Delete proxy pool" }));
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(confirm.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  },
};
