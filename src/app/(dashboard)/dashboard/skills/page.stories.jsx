import React from "react";
import { expect, userEvent, within } from "storybook/test";
import SkillsPage from "./page";

export default { title: "Production/operations/SkillsPage", component: SkillsPage, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/skills" } } };
export const Default = {};
export const CopyEntryLink = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await canvas.findByText("Skills"); await expect(canvas.getAllByRole("button", { name: /Copy link|Copy instruction/i }).length).toBeGreaterThan(0); await userEvent.click(canvas.getAllByRole("button", { name: /Copy link/i })[0]); await expect(canvas.getAllByRole("button", { name: /Copied/i }).length).toBeGreaterThan(0); } };
