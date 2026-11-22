import { expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

it("sends one configured anthropic version regardless of header casing", () => {
  const executor = new DefaultExecutor("anthropic-compatible-test");
  executor.config.headers = { "Anthropic-Version": "2024-01-01" };
  const headers = executor.buildHeaders({ apiKey: "key", providerSpecificData: { baseUrl: "https://example.com" } }, false);
  expect(Object.keys(headers).filter((key) => key.toLowerCase() === "anthropic-version")).toEqual(["anthropic-version"]);
  expect(headers["anthropic-version"]).toBe("2024-01-01");
});
