import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import HeaderLanguage from "./HeaderLanguage";

const meta = { title: "Production/shell/HeaderLanguage", component: HeaderLanguage, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/usage", routes: { "POST /api/locale": { body: {} } } } } };
export default meta;
/** Covers compact header trigger and its composed language chooser. */
export const CompactTrigger = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle("Language"));
    await waitFor(() => expect(within(document.body).getByText("Select Language")).toBeVisible());
  },
};
