import React from "react";
import { expect, within } from "storybook/test";
import EventRow from "./EventRow.jsx";

export default {
  title: "Production/timeline/EventRow",
  component: EventRow,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline/trace-001", params: { id: "trace-001" } } },
};

export const ObjectPayload = {
  args: { event: { seq: 7, type: "response", direction: "in", summary: "200 OK", payload: { status: 200, requestId: "fixture-request" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("response")).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Timeline event #7 details" })).toHaveTextContent('"status": 200');
  },
};

export const StringPayload = {
  args: { event: { seq: 8, type: "sse_chunk", direction: "in", summary: "delta", payload: "data: fixture chunk" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("region", { name: "Timeline event #8 details" })).toHaveTextContent("data: fixture chunk");
  },
};
