import React from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { TranslatorWorkspace } from "./TranslatorWorkspace.jsx";

const clientRequest = JSON.stringify({ model: "gpt-5.2-codex", messages: [{ role: "user", content: "Explain Durin DS fixtures." }] }, null, 2);
const openAiRequest = JSON.stringify({ model: "gpt-5.2-codex", messages: [{ role: "user", content: "Explain Durin DS fixtures." }] }, null, 2);
const targetRequest = JSON.stringify({ provider: "codex", model: "gpt-5.2-codex", body: { prompt: "Explain Durin DS fixtures." } }, null, 2);

const routes = {
  "GET /api/translator/load": { body: { success: true, content: clientRequest } },
  "POST /api/translator/translate": async (request) => {
    const { step } = await request.json();
    if (step === 1) return { body: { success: true, result: { sourceFormat: "OpenAI", targetFormat: "Responses", provider: "codex", model: "gpt-5.2-codex" } } };
    if (step === 2) return { body: { success: true, result: { body: JSON.parse(openAiRequest) } } };
    return { body: { success: true, result: { body: JSON.parse(targetRequest) } } };
  },
  "POST /api/translator/save": { body: { success: true } },
  "POST /api/translator/send": { status: 200, events: [{ id: "fixture", object: "response" }, "[DONE]"] },
};

const meta = {
  title: "Production/translator/TranslatorWorkspace",
  component: TranslatorWorkspace,
  parameters: { layout: "fullscreen", storyFixture: { scenario: "default", pathname: "/dashboard/translator", params: {}, routes } },
};
export default meta;

export const Empty = {};
export const LoadedRequest = { args: { initialContents: { 1: clientRequest }, initialMeta: { sourceFormat: "OpenAI", targetFormat: "Responses", provider: "codex", model: "gpt-5.2-codex" } } };
export const ConvertsRequest = {
  args: { initialContents: { 1: clientRequest } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Expand OpenAI Intermediate" })).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "To OpenAI" }));
    await expect(await canvas.findByRole("button", { name: "Collapse OpenAI Intermediate" })).toBeVisible();
    // Monaco is served locally (.storybook/main.js:25) but takes seconds to boot,
    // and its textbox is a contenteditable div with no `value` — the rendered
    // editor text is the real observable payload.
    const region = await canvas.findByLabelText("OpenAI Intermediate editor");
    await waitFor(() => expect(within(region).getByRole("textbox")).toBeVisible(), { timeout: 20000 });
    await waitFor(() => expect(region).toHaveTextContent("gpt-5.2-codex"), { timeout: 20000 });
  },
};
export const ConvertsToTarget = {
  args: { initialContents: { 3: openAiRequest }, initialMeta: { sourceFormat: "OpenAI", targetFormat: "Responses", provider: "codex", model: "gpt-5.2-codex" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Expand OpenAI Intermediate" }));
    await userEvent.click(await canvas.findByRole("button", { name: "To Target" }));
    await expect(await canvas.findByRole("button", { name: "Collapse Target Request" })).toBeVisible();
    const region = await canvas.findByLabelText("Target Request editor");
    await waitFor(() => expect(within(region).getByRole("textbox")).toBeVisible(), { timeout: 20000 });
    await waitFor(() => expect(region).toHaveTextContent('"provider": "codex"'), { timeout: 20000 });
  },
};
export const SendsTargetRequest = {
  args: { initialContents: { 4: targetRequest }, initialMeta: { sourceFormat: "OpenAI", targetFormat: "Responses", provider: "codex", model: "gpt-5.2-codex" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Expand Target Request" }));
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(await canvas.findByRole("button", { name: "Collapse Provider Response" })).toBeInTheDocument();
  },
};
export const LoadFailure = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/translator", params: {}, routes: { ...routes, "GET /api/translator/load": { body: { success: false, error: "Fixture capture missing" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("button", { name: "To OpenAI" }).parentElement).getByRole("button", { name: "Load" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Fixture capture missing");
  },
};
export const DismissError = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/translator", params: {}, routes: { ...routes, "GET /api/translator/load": { body: { success: false, error: "Fixture capture missing" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("button", { name: "To OpenAI" }).parentElement).getByRole("button", { name: "Load" }));
    const alert = await canvas.findByRole("alert");
    await userEvent.click(await within(alert).findByRole("button", { name: "Dismiss error" }));
    expect(canvas.queryByRole("alert")).toBeNull();
  },
};
export const MobileKeyboard = {
  parameters: { viewport: { defaultViewport: "mobile1" }, storyFixture: { scenario: "default", pathname: "/dashboard/translator", params: {}, routes } },
  args: { initialContents: { 1: clientRequest } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Expand Source Body" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Collapse Source Body" })).toBeVisible();
  },
};
export const RTL = {
  parameters: { storyFixture: { scenario: "default", locale: "ar", pathname: "/dashboard/translator", params: {}, routes } },
  args: { initialContents: { 1: clientRequest } },
  decorators: [(Story) => <div dir="rtl" lang="ar">{Story()}</div>],
};

function SlowProviderStream({ children }) {
  React.useEffect(() => {
    const original = globalThis.fetch;
    let timer;
    globalThis.fetch = (input, init) => {
      if (String(input) !== "/api/translator/send") return original(input, init);
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: partial response\n\n"));
          timer = setInterval(() => controller.enqueue(new TextEncoder().encode("data: next token\n\n")), 500);
        },
        cancel() { clearInterval(timer); },
      }), { headers: { "content-type": "text/event-stream" } }));
    };
    return () => { clearInterval(timer); globalThis.fetch = original; };
  }, []);
  return children;
}
export const CancelledResponse = {
  args: { initialContents: { 4: targetRequest } },
  decorators: [(Story) => <SlowProviderStream><Story /></SlowProviderStream>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Expand Target Request" }));
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(await canvas.findByText("Streaming")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Stop response" }));
    await expect(await canvas.findByText("Cancelled. Received content retained.")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Stop response" })).not.toBeInTheDocument();
  },
};
export const CaptureSaveFailure = {
  ...SendsTargetRequest,
  parameters: { storyFixture: { routes: { ...routes, "POST /api/translator/save": { status: 500, body: { error: "Capture storage unavailable" } } } } },
  play: async (context) => {
    await SendsTargetRequest.play(context);
    await expect(await within(context.canvasElement).findByRole("alert")).toHaveTextContent("saving the capture failed");
  },
};
