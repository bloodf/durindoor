import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import NoAuthProxyCard from "./NoAuthProxyCard";

globalThis.React ??= React;

const BASE_ROUTES = {
  "GET /api/proxy-pools": {
    status: 200,
    body: {
      proxyPools: [
        { id: "pool-a", name: "Pool A" },
        { id: "pool-b", name: "Pool B" },
        { id: "pool-c", name: "Pool C" },
      ],
    },
  },
  "GET /api/settings": {
    status: 200,
    body: { providerStrategies: {} },
  },
  "PATCH /api/settings": {
    status: 200,
    body: { ok: true },
  },
};

const meta = {
  title: "Production/shared-provider/NoAuthProxyCard",
  component: NoAuthProxyCard,
  args: { providerId: "free-anthropic" },
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/free-anthropic",
      params: { id: "free-anthropic" },
      routes: BASE_ROUTES,
    },
  },
};

export default meta;

export const TwoOrMorePoolsReady = {
  parameters: {
    storyFixture: { ...meta.parameters.storyFixture, routes: BASE_ROUTES },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No authentication required")).toBeInTheDocument();
    await expect(await canvas.findByText(/Ready to use/i)).toBeInTheDocument();
    await expect(await canvas.findByLabelText("Rotation Strategy")).toBeInTheDocument();
  },
};

export const SavesStrategyAndPoolsPersist = {
  parameters: {
    storyFixture: (() => {
      let settings;
      const reset = () => {
        settings = {
          providerStrategies: {
            "free-anthropic": { proxyPoolId: "pool-a", rotateStrategy: "round-robin" },
          },
        };
      };
      reset();
      return {
        ...meta.parameters.storyFixture,
        routes: {
          ...BASE_ROUTES,
          "GET /api/settings": () => ({ status: 200, body: settings }),
          "PATCH /api/settings": async (request) => {
            settings = await request.json();
            return { status: 200, body: { ok: true } };
          },
        },
        reset,
      };
    })(),
  },
  beforeEach: ({ parameters }) => parameters.storyFixture.reset(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const strategy = await canvas.findByLabelText("Rotation Strategy");
    await waitFor(() => expect(strategy).toHaveTextContent("Round-robin"));

    await userEvent.click(strategy);
    await userEvent.click(await within(document.body).findByRole("option", { name: "None (single pool)" }));

    const pool = await canvas.findByLabelText("Proxy Pool");
    await waitFor(() => expect(pool).toBeEnabled());
    await userEvent.click(pool);
    await userEvent.click(await within(document.body).findByRole("option", { name: "Pool B" }));
    await expect(pool).toHaveTextContent("Pool B");
    await expect(await (await fetch("/api/settings")).json()).toEqual({
      providerStrategies: { "free-anthropic": { proxyPoolId: "pool-b" } },
    });
  },
};

export const FewerThanTwoPoolsDisablesRotation = {
  parameters: {
    storyFixture: {
      ...meta.parameters.storyFixture,
      routes: {
        ...BASE_ROUTES,
        "GET /api/proxy-pools": { status: 200, body: { proxyPools: [{ id: "only", name: "Only" }] } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Need at least 2 active proxy pools/i)).toBeInTheDocument();
  },
};

// Private select interaction: choose a rotation option, assert persisted consumer state.
export const RotationStrategyChangePersists = {
  parameters: {
    storyFixture: (() => {
      let settings;
      const reset = () => { settings = { providerStrategies: {} }; };
      reset();
      return {
        ...meta.parameters.storyFixture,
        routes: {
          ...BASE_ROUTES,
          "GET /api/settings": () => ({ status: 200, body: settings }),
          "PATCH /api/settings": async (request) => {
            settings = await request.json();
            return { status: 200, body: { ok: true } };
          },
        },
        reset,
      };
    })(),
  },
  beforeEach: ({ parameters }) => parameters.storyFixture.reset(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByLabelText("Rotation Strategy");
    await expect(trigger).toHaveTextContent("None (single pool)");
    await userEvent.click(trigger);
    const listbox = await within(document.body).findByRole("listbox");
    await userEvent.click(await within(listbox).findByRole("option", { name: "Round-robin" }));
    await expect(trigger).toHaveTextContent("Round-robin");
    await expect(await (await fetch("/api/settings")).json()).toEqual({
      providerStrategies: { "free-anthropic": { rotateStrategy: "round-robin" } },
    });
  },
};
