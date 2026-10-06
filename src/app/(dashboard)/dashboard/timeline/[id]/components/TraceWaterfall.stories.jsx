import React from "react";
import { expect, userEvent, within } from "storybook/test";
import TraceWaterfall from "./TraceWaterfall.jsx";

const trace = { id: "trace-001", status: "ok", provider: "codex", model: "gpt-5", total_ms: 1_200 };

const requestEvents = [
  { seq: 1, t_ms: 0, type: "client_request", direction: "in", summary: "POST /v1/chat/completions", payload: { model: "gpt-5" } },
  { seq: 2, t_ms: 15, type: "translate", direction: "system", summary: "openai → openai", payload: null },
  { seq: 3, t_ms: 40, type: "request", direction: "out", summary: "POST upstream", payload: { stream: true } },
  { seq: 4, t_ms: 610, type: "response", direction: "in", summary: "200", payload: { status: 200 } },
];

const chunkEvents = [
  { seq: 1, t_ms: 0, type: "request", direction: "out", summary: "POST /v1/chat/completions", payload: { model: "gpt-5" } },
  { seq: 2, t_ms: 300, type: "sse_chunk", direction: "in", summary: "open", payload: "data: {\"choices\":[{}]}" },
  { seq: 3, t_ms: 340, type: "sse_chunk", direction: "in", summary: "delta", payload: "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}" },
  { seq: 4, t_ms: 380, type: "sse_chunk", direction: "in", summary: "delta", payload: "data: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}" },
  { seq: 5, t_ms: 900, type: "response", direction: "in", summary: "done", payload: { status: 200 } },
];

export default {
  title: "Production/timeline/TraceWaterfall",
  component: TraceWaterfall,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline/trace-001", params: { id: "trace-001" } } },
  args: { trace, events: requestEvents },
};

export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = within(canvas.getByRole("list", { name: "Trace waterfall" })).getAllByRole("button");
    await expect(rows).toHaveLength(4);
    await expect(rows[3]).toHaveTextContent("610–1200 ms");
    await userEvent.click(rows[0]);
    await expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("region", { name: /Timeline event #1 details/ })).toHaveTextContent('"model": "gpt-5"');
  },
};

export const CollapsedChunks = {
  args: { events: chunkEvents },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chunkRow = canvas.getByRole("button", { name: /3 chunks/ });
    await expect(chunkRow).toHaveTextContent("300–900 ms");
    await userEvent.click(chunkRow);
    await expect(canvas.getAllByRole("region", { name: /Timeline event #[234] details/ })).toHaveLength(3);
  },
};
