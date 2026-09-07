import React, { useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import PricingModal from "./PricingModal";

const initialPricing = {
  openai: { "gpt-5": { input: 2.5, output: 10, cached: 0, reasoning: 0, cache_creation: 0 } },
  anthropic: {
    "claude-sonnet-4-5-20250929": { input: 3, output: 15, cached: 0, reasoning: 15, cache_creation: 3.75 },
  },
};

const RESET_PRICING = {
  openai: { "gpt-5": { input: 1, output: 4, cached: 0, reasoning: 0, cache_creation: 0 } },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function PricingHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-dd border border-dd-border bg-dd-surface-2 px-3 py-2 text-[13px] text-dd-text"
      >
        Reopen pricing
      </button>
      <PricingModal isOpen={open} onClose={() => setOpen(false)} onSave={() => {}} />
    </>
  );
}

const meta = {
  title: "Production/shared-domain/PricingModal",
  component: PricingModal,
  // Every pricing scenario exercises play; factories are opaque to CSF indexing.
  tags: ["play-fn"],
  parameters: {
    layout: "centered",
    storyFixture: { scenario: "default", pathname: "/dashboard/settings/pricing", params: {}, routes: {} },
  },
};
export default meta;

function makeMutablePricingStory({ name, buildRoutes, play }) {
  let store;
  return {
    name,
    render: () => <PricingHarness />,
    beforeEach: () => {
      store = clone(initialPricing);
    },
    parameters: {
      storyFixture: {
        scenario: "default",
        pathname: "/dashboard/settings/pricing",
        params: {},
        get routes() {
          return buildRoutes(
            () => store,
            (next) => {
              store = next;
            },
          );
        },
      },
    },
    play,
  };
}

export const Loaded = makeMutablePricingStory({
  buildRoutes: (getStore) => ({
    "GET /api/pricing": () => ({ body: clone(getStore()), status: 200 }),
  }),
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const gpt5 = await waitFor(() => within(body).getByLabelText("gpt-5 input rate"));
    expect(gpt5).toHaveValue(2.5);
    const sonnet = await waitFor(() =>
      within(body).getByLabelText("claude-sonnet-4-5-20250929 reasoning rate"),
    );
    expect(sonnet).toHaveValue(15);
  },
});

export const SavePersistsAndReopens = makeMutablePricingStory({
  buildRoutes: (getStore, setStore) => ({
    "GET /api/pricing": () => ({ body: clone(getStore()), status: 200 }),
    "PATCH /api/pricing": async (request) => {
      const body = await request.json();
      const next = clone(getStore());
      for (const [provider, models] of Object.entries(body)) {
        next[provider] = { ...next[provider], ...models };
      }
      setStore(next);
      return { body: { ok: true }, status: 200 };
    },
  }),
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const input = await waitFor(() => within(body).getByLabelText("gpt-5 input rate"));
    // Native number field: fireEvent.change commits the value atomically
    // without the residual-digits problem userEvent.type has on static
    // Storybook (e.g. "2.555" instead of "5.5").
    fireEvent.change(input, { target: { value: "5.5" } });
    await userEvent.click(within(body).getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(within(body).getByRole("button", { name: "Reopen pricing" })).toBeVisible();
    });
    await userEvent.click(within(body).getByRole("button", { name: "Reopen pricing" }));
    const reopened = await waitFor(() => within(body).getByLabelText("gpt-5 input rate"));
    expect(reopened).toHaveValue(5.5);
  },
});

export const SaveErrorVisible = {
  render: () => <PricingHarness />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/settings/pricing",
      params: {},
      routes: {
        "GET /api/pricing": { body: initialPricing, status: 200 },
        "PATCH /api/pricing": { body: { error: "rate-locked" }, status: 423 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const input = await waitFor(() => within(body).getByLabelText("gpt-5 input rate"));
    fireEvent.change(input, { target: { value: "7" } });
    await userEvent.click(within(body).getByRole("button", { name: "Save changes" }));
    const alert = await waitFor(() => within(body).getByRole("alert"));
    expect(alert).toHaveTextContent("rate-locked");
    expect(within(body).getByLabelText("gpt-5 input rate")).toBeInTheDocument();
  },
};

export const LoadErrorVisible = {
  render: () => <PricingHarness />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/settings/pricing",
      params: {},
      routes: { "GET /api/pricing": { body: { error: "db offline" }, status: 503 } },
    },
  },
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const alert = await waitFor(() => within(body).getByRole("alert"));
    expect(alert).toHaveTextContent("db offline");
    expect(within(body).getByLabelText("accounts/fireworks/models/deepseek-v4-flash input rate")).toBeInTheDocument();
  },
};

function makeDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export const ResetPendingDisablesCloseAndChangesRates = (() => {
  let store;
  let deferred;
  return {
    render: () => <PricingHarness />,
    beforeEach: () => {
      store = clone(initialPricing);
      deferred = makeDeferred();
    },
    parameters: {
      storyFixture: {
        scenario: "default",
        pathname: "/dashboard/settings/pricing",
        params: {},
        get routes() {
          return {
            "GET /api/pricing": () => ({ body: clone(store), status: 200 }),
            "DELETE /api/pricing": async () => {
              await deferred.promise;
              store = clone(RESET_PRICING);
              return { body: clone(store), status: 200 };
            },
          };
        },
      },
    },
    play: async ({ canvasElement }) => {
      const body = canvasElement.ownerDocument.body;
      const initialInput = await waitFor(() => within(body).getByLabelText("gpt-5 input rate"));
      expect(Number(initialInput.value)).toBe(2.5);
      await userEvent.click(within(body).getByRole("button", { name: "Reset to defaults" }));
      const confirm = await waitFor(() =>
        within(body).getByRole("dialog", { name: "Reset pricing to defaults?" }),
      );
      const resetButton = within(confirm).getByRole("button", { name: "Reset" });
      const cancelButton = within(confirm).getByRole("button", { name: "Cancel" });
      await userEvent.click(resetButton);
      // Source sets saving=true mid-DELETE; Modal `pending` disables the
      // confirm buttons. expect.poll is not in storybook/test's expect,
      // so use waitFor polling instead.
      await waitFor(() => {
        expect(resetButton).toBeDisabled();
        expect(cancelButton).toBeDisabled();
      });
      await userEvent.click(cancelButton);
      await waitFor(() => {
        expect(within(body).getByRole("dialog", { name: "Reset pricing to defaults?" })).toBeVisible();
      });
      deferred.resolve();
      await waitFor(() => {
        const input = within(body).getByLabelText("gpt-5 input rate");
        expect(Number(input.value)).toBe(1);
      });
    },
  };
})();
