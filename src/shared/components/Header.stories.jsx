import React, { useEffect } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Header from "./Header";
import { useHeaderSearchStore } from "@/store/headerSearchStore";

function SearchHeader() {
  useEffect(() => {
    useHeaderSearchStore.setState({ visible: true, placeholder: "Search requests", query: "" });
    return () => useHeaderSearchStore.setState({ visible: false, query: "", placeholder: "" });
  }, []);
  return <Header onMenuClick={() => undefined} />;
}

const meta = {
  title: "Production/shell/Header",
  component: Header,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers",
      routes: {
        "GET /api/auth/status": { body: { displayName: "Frodo", loginMethod: "OIDC" } },
        "POST /api/auth/logout": { body: {} },
      },
    },
  },
};
export default meta;

/** Covers persistent OIDC session chip, register/unregister of the global header search, and query clear. */
export const SessionAndSearch = {
  render: () => <SearchHeader />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Providers")).toBeVisible());
    await waitFor(() => expect(canvas.getByText("Frodo")).toBeVisible());
    await expect(canvas.getByText("OIDC")).toBeVisible();
    const search = canvas.getByPlaceholderText("Search requests");
    await userEvent.type(search, "claude");
    await expect(search).toHaveValue("claude");
    await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));
    await expect(search).toHaveValue("");
  },
};

export const MobileMenu = { args: { onMenuClick: () => undefined } };
