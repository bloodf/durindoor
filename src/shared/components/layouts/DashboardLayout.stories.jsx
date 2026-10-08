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
  await expect(canvas.getByRole("button", { name: "Dismiss notification" })).toBeVisible();
} });
export const SuccessToast = { ...toast("success"), tags: ["play-fn"] };
export const ErrorToast = { ...toast("error"), tags: ["play-fn"] };
export const WarningToast = { ...toast("warning"), tags: ["play-fn"] };
export const InfoToast = { ...toast("info"), tags: ["play-fn"] };

export const ToastDismissal = {
  ...SuccessToast,
  play: async ({ canvasElement }) => {
    await SuccessToast.play({ canvasElement });
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => expect(canvas.queryByText("success message")).not.toBeInTheDocument());
    await expect(canvas.getByText("Page content")).toBeVisible();
  },
};
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
    await expect(within(dialog).getByRole("link", { name: /Usage/ })).toBeVisible();
  },
};

export const MobileDrawerTransitions = {
  ...MobileDrawer,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Open navigation" });
    await MobileDrawer.play({ canvasElement });
    const dialog = within(document.body).getByRole("dialog", { name: "Navigation" });
    await userEvent.click(within(dialog).getByRole("link", { name: /Usage/ }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument());
    await userEvent.click(toggle);
    const reopened = await within(document.body).findByRole("dialog", { name: "Navigation" });
    await Promise.all(reopened.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations)).map(({ finished }) => finished.catch(() => {})));
    await userEvent.click(within(reopened).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(toggle).toHaveFocus());
  },
};
function PersistedExample() {
  const [key, setKey] = useState(0);
  return <><button type="button" onClick={() => setKey((k) => k + 1)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus">Remount</button><DashboardLayout key={key}><p>Desktop body</p></DashboardLayout></>;
}
export const PersistedDesktopCollapse = {
  beforeEach: () => {
    const storage = window.localStorage;
    const previous = storage.getItem("durindoor.sidebar.collapsed");
    storage.removeItem("durindoor.sidebar.collapsed");
    // Mobile cannot operate the hidden desktop rail; seed its saved preference
    // before mounting the real layout, then exercise independent mobile navigation.
    if (!window.matchMedia("(min-width: 1024px)").matches) storage.setItem("durindoor.sidebar.collapsed", "1");
    return () => previous === null
      ? storage.removeItem("durindoor.sidebar.collapsed")
      : storage.setItem("durindoor.sidebar.collapsed", previous);
  },
  render: () => <PersistedExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const win = canvasElement.ownerDocument.defaultView;
    const portal = within(canvasElement.ownerDocument.body);
    if (win.matchMedia("(min-width: 1024px)").matches) {
      await userEvent.click(await canvas.findByRole("button", { name: "Collapse sidebar" }));
      await waitFor(() => expect(win.localStorage.getItem("durindoor.sidebar.collapsed")).toBe("1"));
      await userEvent.click(canvas.getByRole("button", { name: "Remount" }));
      await waitFor(() => expect(canvas.getByRole("button", { name: "Expand sidebar" })).toBeVisible());
    } else {
      await expect(win.localStorage.getItem("durindoor.sidebar.collapsed")).toBe("1");
      await expect(canvas.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
      await expect(canvas.queryByRole("button", { name: "Expand sidebar" })).not.toBeInTheDocument();
      const opener = await canvas.findByRole("button", { name: "Open navigation" });
      await expect(opener).toBeVisible();
      await userEvent.click(opener);
      const navigation = within(await portal.findByRole("dialog", { name: "Navigation" }));
      await waitFor(() => expect(navigation.getByText("Usage", { exact: true })).toBeVisible());
      await userEvent.click(navigation.getByRole("link", { name: "Usage", exact: true }));
      await waitFor(() => {
        expect(portal.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
      });
      await expect(win.localStorage.getItem("durindoor.sidebar.collapsed")).toBe("1");
      await userEvent.click(canvas.getByRole("button", { name: "Remount" }));
      await waitFor(() => expect(opener).not.toBeInTheDocument());
      const remountedOpener = await canvas.findByRole("button", { name: "Open navigation" });
      await expect(remountedOpener).toBeVisible();
      await expect(win.localStorage.getItem("durindoor.sidebar.collapsed")).toBe("1");
      await userEvent.click(remountedOpener);
      const remountedNavigation = within(await portal.findByRole("dialog", { name: "Navigation" }));
      await waitFor(() => expect(remountedNavigation.getByText("Usage", { exact: true })).toBeVisible());
      await userEvent.click(remountedNavigation.getByRole("button", { name: "Close", exact: true }));
      await waitFor(() => {
        expect(portal.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();
        expect(remountedOpener).toHaveFocus();
      });
      await expect(canvas.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
      await expect(canvas.queryByRole("button", { name: "Expand sidebar" })).not.toBeInTheDocument();
    }
    await expect(win.localStorage.getItem("durindoor.sidebar.collapsed")).toBe("1");
    const body = canvas.getByRole("region", { name: "Page content", exact: true });
    await expect(body).toBeVisible();
    await expect(within(body).getByText("Desktop body", { exact: true })).toBeVisible();
    await userEvent.click(body);
    await expect(body).toHaveFocus();
  },
};
export const PlaygroundFullBleed = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/playground", routes } }, args: { children: <div>Playground</div> } };
