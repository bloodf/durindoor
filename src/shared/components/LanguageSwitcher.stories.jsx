import React from "react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";
import LanguageSwitcher from "./LanguageSwitcher";

const meta = { title: "Production/shell/LanguageSwitcher", component: LanguageSwitcher };
export default meta;

export const Success = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/profile",
      routes: {
        "POST /api/locale": { body: {} },
        "GET /i18n/literals/en.json": { body: {} },
        "GET /i18n/literals/vi.json": { body: {} },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle("Language"));
    await userEvent.click(await within(document.body).findByTitle("Tiếng Việt"));
    await waitFor(() => expect(within(document.body).queryByText("Select Language")).not.toBeInTheDocument());
  },
};

export const RequestError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/profile",
      routes: {
        "POST /api/locale": { body: { error: "Unavailable" }, status: 503 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const original = console.error;
    const error = spyOn(console, "error").mockImplementation((...args) => {
      if (args[0] !== "Failed to set locale:" || !String(args[1]).includes("503")) original(...args);
    });
    try {
      await userEvent.click(canvas.getByTitle("Language"));
      await userEvent.click(await within(document.body).findByTitle("Tiếng Việt"));
      await waitFor(() => expect(within(document.body).getByRole("alert")).toHaveTextContent("503"));
      await expect(error).toHaveBeenCalled();
    } finally { error.mockRestore(); }
  },
};
