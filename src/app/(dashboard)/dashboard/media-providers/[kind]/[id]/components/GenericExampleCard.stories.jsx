import React from "react";
import { expect, userEvent, within } from "storybook/test";
import { GenericExampleCard } from "./GenericExampleCard";

// Real RGBA PNGs: partial preview is 32×32, completed generation is 64×64.
const partialPng = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAANUlEQVR4nO3XMREAAAgDMZzWAUrwDDJYMnT/y9ZKz36uBBAgQIAAAQIECBAgQIAAAQJ5vucHgepgiB6GLQcAAAAASUVORK5CYII=";
const generatedPng = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAoklEQVR4nO3RMQ0AIADEQIShCXX4AxlHQofbP98x1z4/G3qA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gG6gNYBuoDWAbqA1gHzgQrSBfgU0izO3dP5AAAAAElFTkSuQmCC";

const routes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "GET /api/providers/client": { body: { connections: [] }, status: 200 },
  "POST /api/v1/search": { body: { results: [{ title: "Example", url: "https://example.com", snippet: "Example snippet" }] }, status: 200 },
};

export default {
  title: "Production/media/GenericExampleCard",
  component: GenericExampleCard,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/webSearch/duckduckgo-web",
      params: { kind: "webSearch", id: "duckduckgo-web" },
      routes,
    },
  },
};

export const WebSearch = { args: { providerId: "duckduckgo-web", kind: "webSearch" } };

export const WebSearchRun = {
  args: { providerId: "duckduckgo-web", kind: "webSearch" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run/ });
    await userEvent.click(run);
    await expect(await canvas.findByText(/Example snippet/, {}, { timeout: 3000 })).toBeInTheDocument();
  },
};

export const ImageGen = {
  args: { providerId: "openai", kind: "image" },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/image/openai",
      params: { kind: "image", id: "openai" },
      routes: {
        "GET /api/tunnel/status": { body: {}, status: 200 },
        "GET /api/providers/client": { body: { connections: [] }, status: 200 },
        "POST /api/v1/images/generations": { body: { data: [{ b64_json: generatedPng }] }, status: 200 },
      },
    },
  },
};

// GenericExampleCard parses actual SSE framing. Fixture `events` entries are
// data-wrapped, so this route supplies raw event-stream text instead.
export const CodexStreamingRun = {
  args: { providerId: "codex", kind: "image" },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/image/codex",
      params: { kind: "image", id: "codex" },
      routes: {
        "GET /api/tunnel/status": { body: {}, status: 200 },
        "GET /api/providers/client": { body: { connections: [] }, status: 200 },
        "POST /api/v1/images/generations": {
          body: `event: progress\ndata: {"stage":"queued"}\n\nevent: progress\ndata: {"stage":"rendering"}\n\nevent: partial_image\ndata: ${JSON.stringify({ b64_json: partialPng })}\n\nevent: done\ndata: ${JSON.stringify({ data: [{ b64_json: generatedPng }] })}\n\n`,
          contentType: "text/event-stream",
          status: 200,
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run/ });
    await userEvent.click(run);
    const image = await canvas.findByRole("img", { name: "Generated" }, { timeout: 3000 });
    await image.decode();
    await expect(image).toBeVisible();
    await expect(image.naturalWidth).toBeGreaterThan(0);
    await expect(image.naturalHeight).toBeGreaterThan(0);
    await expect(canvas.getByRole("link", { name: "Download" })).toBeVisible();
  },
};

export const RunError = {
  args: { providerId: "duckduckgo-web", kind: "webSearch" },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/webSearch/duckduckgo-web",
      params: { kind: "webSearch", id: "duckduckgo-web" },
      routes: {
        "GET /api/tunnel/status": { body: {}, status: 200 },
        "GET /api/providers/client": { body: { connections: [] }, status: 200 },
        "POST /api/v1/search": { body: { error: "Search service unavailable" }, status: 503 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Run" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Search service unavailable");
  },
};
