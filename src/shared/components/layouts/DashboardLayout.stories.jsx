import React, { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import DashboardLayout from "./DashboardLayout";
import { useNotificationStore } from "@/store/notificationStore";

const routes = { "GET /api/settings": { body: {} }, "GET /api/version": { body: {} }, "GET /api/auth/status": { body: {} } };
export default { title: "Production/shell/DashboardLayout", component: DashboardLayout, parameters: { layout: "fullscreen", storyFixture: { scenario: "default", pathname: "/dashboard/usage", routes } } };
function ToastExample({ type }) {
  useEffect(() => {
    const state = useNotificationStore.getState();
    const previous = state.notifications;
    state.clearAll();
    state.addNotification({ type, message: `${type} message`, duration: 0 });
    return () => useNotificationStore.setState({ notifications: previous });
  }, [type]);
  return <DashboardLayout><p>Page content</p></DashboardLayout>;
}
const toast = (type) => ({ render: () => <ToastExample type={type} />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByText(`${type} message`)).toBeVisible());
  await userEvent.click(canvas.getByRole("button", { name: "Dismiss notification" }));
  await waitFor(() => expect(canvas.queryByText(`${type} message`)).not.toBeInTheDocument());
} });
export const SuccessToast = { ...toast("success"), tags: ["play-fn"] };
export const ErrorToast = { ...toast("error"), tags: ["play-fn"] };
export const WarningToast = { ...toast("warning"), tags: ["play-fn"] };
export const InfoToast = { ...toast("info"), tags: ["play-fn"] };
export const MobileDrawer = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <div className="mobile-drawer-story"><style>{".lg\\:hidden{display:flex!important}"}</style><DashboardLayout><p>Mobile body</p></DashboardLayout></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("button", { name: "Open navigation" });
    await userEvent.click(toggle);
    const dialog = await within(document.body).findByRole("dialog", { name: "Navigation" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations)).map(({ finished }) => finished.catch(() => {})));
    await userEvent.click(within(dialog).getByRole("link", { name: /Usage/ }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(toggle);
    const reopened = await within(document.body).findByRole("dialog", { name: "Navigation" });
    // Native Escape is exercised by Playwright, not synthetic userEvent.
    await userEvent.click(within(reopened).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(toggle).toHaveFocus());
  },
};
function PersistedExample() {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const old = localStorage.getItem("durindoor.sidebar.collapsed");
    localStorage.removeItem("durindoor.sidebar.collapsed");
    setReady(true);
    return () => old === null ? localStorage.removeItem("durindoor.sidebar.collapsed") : localStorage.setItem("durindoor.sidebar.collapsed", old);
  }, []);
  return ready ? <><button type="button" onClick={() => setKey((k) => k + 1)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus">Remount</button><DashboardLayout key={key}><p>Desktop body</p></DashboardLayout></> : null;
}
export const PersistedDesktopCollapse = {
  render: () => <PersistedExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Collapse sidebar" }));
    await waitFor(() => expect(localStorage.getItem("durindoor.sidebar.collapsed")).toBe("1"));
    await userEvent.click(canvas.getByRole("button", { name: "Remount" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Expand sidebar" })).toBeVisible());
  },
};
export const PlaygroundFullBleed = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/playground", routes } }, args: { children: <div>Playground</div> } };
