import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import ReviewButton from "./ReviewButton.jsx";

const meta = { title: "Motion/Actions", parameters: { v5Review: { componentOnly: true } } };
export default meta;
function Form() {
  const [saved, setSaved] = useState(false);
  return <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }} className="flex flex-wrap gap-3 p-6">
    <ReviewButton type="submit" variant="primary" icon="save">Save changes</ReviewButton>
    <ReviewButton disabled icon="sync">Sync unavailable</ReviewButton>
    <ReviewButton loading>Saving changes</ReviewButton>
    {saved && <p role="status">Changes saved.</p>}
  </form>;
}
export const SaveAndReadback = { render: () => <Form />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
  await expect(canvas.getByRole("status")).toHaveTextContent("Changes saved.");
  await expect(canvas.getByRole("button", { name: "Sync unavailable" })).toBeDisabled();
  await expect(canvas.getByRole("button", { name: "Saving changes" })).toHaveAttribute("aria-busy", "true");
} };
