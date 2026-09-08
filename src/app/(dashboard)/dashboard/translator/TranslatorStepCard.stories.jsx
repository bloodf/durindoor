import React, { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { TranslatorStepCard } from "./TranslatorWorkspace.jsx";

const sampleStep = { id: 1, label: "Client Request", file: "1_req_client.json", lang: "json", desc: "Raw request from client" };
const sampleTextStep = { id: 5, label: "Provider Response", file: "5_res_provider.txt", lang: "text", desc: "Raw SSE from provider" };
const clientRequest = JSON.stringify({ model: "gpt-5.2-codex", messages: [{ role: "user", content: "Fixture request" }] }, null, 2);

const meta = {
  title: "Production/translator/TranslatorStepCard",
  component: TranslatorStepCard,
  parameters: { layout: "fullscreen", storyFixture: { scenario: "default", pathname: "/dashboard/translator", params: {}, routes: {} } },
  args: { step: sampleStep, content: "", expanded: false, loading: false, onToggle: fn(), onLoad: fn(), onFormat: fn(), onCopy: fn(), action: null },
};
export default meta;

export const CollapsedEmpty = {};
export const CollapsedLoaded = { args: { content: clientRequest } };
export const Expanded = { args: { content: clientRequest, expanded: true } };
export const TextExpanded = { args: { step: sampleTextStep, content: "data: hello\n\n", expanded: true } };
export const Loading = {
  args: { expanded: true, loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The loading state is only observable through the status label and the
    // busy Load button; the card heading renders either way.
    await expect(await canvas.findByText("Loading")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Load" })).toBeDisabled();
  },
};
export const KeyboardEnterToggle = {
  args: { content: clientRequest },
  render: (args) => {
    const [expanded, setExpanded] = useState(false);
    return <TranslatorStepCard {...args} expanded={expanded} onToggle={() => { args.onToggle(); setExpanded((current) => !current); }} />;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Expand Client Request" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onToggle).toHaveBeenCalledTimes(1);
    await expect(canvas.getByRole("button", { name: "Collapse Client Request" })).toBeVisible();
  },
};
