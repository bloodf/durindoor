import { isFunction } from "@/shared/utils/typeChecks.js";
import { expect, userEvent, within } from "storybook/test";

/** Exercise the real collection component against an initial failed read and a successful retry. */
export function failedReadStory({ routes, url, pathname, params = {}, failure = "http", loadedText }) {
  let failed = true;
  return {
    beforeEach: () => { failed = true; },
    parameters: { storyFixture: { scenario: "default", pathname, params, routes: {
      ...routes,
      [`GET ${url}`]: async (...args) => {
        if (failed) {
          if (failure === "network") throw new Error("Connection interrupted");
          if (failure === "malformed") return { body: "not json", contentType: "text/plain" };
          return { status: 503, body: { error: "Configuration unavailable" } };
        }
        const value = routes[`GET ${url}`];
        return isFunction(value) ? value(...args) : value;
      },
    } } },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const alert = await canvas.findByRole("alert");
      await expect(alert).toHaveTextContent(/could not be loaded/i);
      failed = false;
      await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
      await expect((await canvas.findAllByText(loadedText))[0]).toBeVisible();
    },
  };
}
