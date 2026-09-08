import React from "react";
import { expect, userEvent, within } from "storybook/test";
import { GenericExampleCard } from "./GenericExampleCard";

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
        "POST /api/v1/images/generations": { body: { data: [{ b64_json: "AAAA" }] }, status: 200 },
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
          body: "event: progress\ndata: {\"stage\":\"queued\"}\n\nevent: progress\ndata: {\"stage\":\"rendering\"}\n\nevent: partial_image\ndata: {\"b64_json\":\"AAAA\"}\n\nevent: done\ndata: {\"data\":[{\"b64_json\":\"BBBB\"}]}\n\n",
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
    await expect(await canvas.findByAltText("Generated", {}, { timeout: 3000 })).toBeInTheDocument();
  },
};
