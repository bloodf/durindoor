import React from "react";
import { expect, within } from "storybook/test";

import InferenceStatus from "./InferenceStatus";

const meta = {
  title: "Production/providers/InferenceStatus",
  component: InferenceStatus,
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/openai",
      params: { id: "openai" },
    },
  },
};

export default meta;

/** No session test yet. */
export const Empty = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Inference not tested");
  },
};

/** The session test is still running. */
export const Loading = {
  args: { testing: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Inference test running");
  },
};

/** The session test failed. Catalog and connection status stay untouched. */
export const Error = {
  args: { status: "error" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Inference failed in this session");
  },
};

/** The session test passed. */
export const Passed = {
  args: { status: "ok" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Inference passed in this session");
  },
};

/** The session test was skipped. */
export const Skipped = {
  args: { status: "skipped" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Inference skipped in this session");
  },
};
