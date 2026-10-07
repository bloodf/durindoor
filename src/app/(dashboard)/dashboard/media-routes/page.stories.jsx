import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import MediaRoutesPage from "./page.js";

const automaticRoute = {
  id: "image",
  label: "Image generation",
  endpoint: "/v1/images/generations",
  saved: [],
  candidates: [
    { id: "openai/gpt-image-1", name: "GPT Image" },
    { id: "openai/dall-e-3", name: "DALL-E 3" },
    { id: "cloudflare-ai/flux", name: "Flux" },
    { id: "fal/flux-pro", name: "Flux Pro" },
    { id: "together/flux", name: "Together Flux" },
    { id: "replicate/flux", name: "Replicate Flux" },
  ],
  effective: ["openai/gpt-image-1", "openai/dall-e-3", "cloudflare-ai/flux", "fal/flux-pro", "together/flux", "replicate/flux"],
  endpoints: [{ path: "/v1/images/edits", effective: [] }],
};

const customRoute = {
  id: "embedding",
  label: "Embeddings",
  endpoint: "/v1/embeddings",
  saved: ["openai/text-embedding-3-small", "retired/model"],
  candidates: [
    { id: "openai/text-embedding-3-small", name: "Text Embedding 3 Small" },
    { id: "openai/text-embedding-3-large", name: "Text Embedding 3 Large" },
  ],
  effective: ["openai/text-embedding-3-small", "retired/model"],
  endpoints: [],
};

const routes = {
  "GET /api/media-providers/routes": { body: { routes: [automaticRoute, customRoute] }, status: 200 },
};

let savedFallbackOrder = [];
const savedImageRoute = () => ({
  ...automaticRoute,
  saved: [...savedFallbackOrder],
  effective: savedFallbackOrder.length ? [...savedFallbackOrder] : automaticRoute.effective,
});

export default {
  title: "Production/media/MediaRoutes",
  component: MediaRoutesPage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-routes",
      params: {},
      routes,
    },
  },
};

export const AutomaticAndCustom = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Media Routes")).toBeVisible();
    await expect(canvas.getByText("Automatic")).toBeVisible();
    await expect(canvas.getByText("+1 more")).toBeVisible();
    await expect(canvas.getByText("Custom order")).toBeVisible();
    await expect(canvas.getByText("unavailable, skipped")).toBeVisible();
    await expect(canvas.getByText("no model in this route can run here")).toBeVisible();
  },
};

export const CustomizeAddRemoveAndSave = {
  beforeEach: () => {
    savedFallbackOrder = [];
    return () => { savedFallbackOrder = []; };
  },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-routes",
      params: {},
      routes: {
        ...routes,
        "GET /api/media-providers/routes": () => ({ body: { routes: [savedImageRoute(), customRoute] }, status: 200 }),
        "PUT /api/media-providers/routes": async (request) => {
          const { models } = await request.json();
          savedFallbackOrder = [...models];
          return { body: { route: savedImageRoute() }, status: 200 };
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByText("Image generation");
    const imageCard = within(title.parentElement?.parentElement?.parentElement);
    await userEvent.click(await imageCard.findByRole("button", { name: "Customize" }));
    await expect(imageCard.getByRole("button", { name: /Drag to reorder openai\/gpt-image-1/ })).toBeVisible();
    await userEvent.click(imageCard.getByRole("combobox"));
    await userEvent.click(await within(document.body).findByRole("option", { name: /openai\/dall-e-3/ }));
    await userEvent.click(imageCard.getByRole("button", { name: "Add" }));
    await userEvent.click(imageCard.getByRole("button", { name: /Remove openai\/gpt-image-1/ }));
    await userEvent.click(imageCard.getByRole("button", { name: "Discard" }));
    await userEvent.click(imageCard.getByRole("button", { name: "Customize" }));
    await userEvent.click(imageCard.getByRole("combobox"));
    await userEvent.click(await within(document.body).findByRole("option", { name: /openai\/dall-e-3/ }));
    await userEvent.click(imageCard.getByRole("button", { name: "Add" }));
    await userEvent.click(imageCard.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const savedTitle = canvas.getByText("Image generation");
      const savedCard = within(savedTitle.parentElement.parentElement.parentElement);
      expect(savedCard.getByRole("button", { name: "Use automatic order" })).toBeVisible();
      expect(savedCard.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(savedCard.getAllByText(/openai\/(gpt-image-1|dall-e-3)/, { selector: "code" }).map((element) => element.textContent)).toEqual(["openai/gpt-image-1", "openai/dall-e-3"]);
    });
  },
};

export const LoadError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-routes",
      params: {},
      routes: { "GET /api/media-providers/routes": { body: { error: "Routes service unavailable" }, status: 503 } },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("alert")).toHaveTextContent("Routes service unavailable");
  },
};

export const EmptyRoute = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-routes",
      params: {},
      routes: { "GET /api/media-providers/routes": { body: { routes: [{ id: "music", label: "Music", endpoint: "/v1/music", saved: [], candidates: [], effective: [], endpoints: [] }] }, status: 200 } },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No connected provider supports this")).toBeVisible();
  },
};
