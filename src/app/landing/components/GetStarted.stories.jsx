import React from "react";
import { expect, userEvent, within } from "storybook/test";
import GetStarted from "./GetStarted.js";

export default {
  title: "Production/Public/Landing/GetStarted",
  component: GetStarted,
};

export const Default = { render: () => <GetStarted /> };

export const CopyCommand = {
  render: () => <GetStarted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Copy install command"));
    await expect(canvas.getByLabelText("Command copied")).toBeInTheDocument();
  },
};
