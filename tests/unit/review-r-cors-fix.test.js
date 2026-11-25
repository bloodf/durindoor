import { describe, expect, it } from "vitest";

const routes = import.meta.glob([
  "../../src/app/api/v1/**/route.js",
  "../../src/app/api/v1beta/**/route.js",
  "../../src/app/backend-api/codex/**/route.js",
]);
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

describe("public route CORS preflight", () => {
  it.each(Object.entries(routes))("matches exported handlers and permits browser headers: %s", async (_path, load) => {
    const route = await load();
    const request = new Request("https://example.test/", {
      method: "OPTIONS",
      headers: { Origin: "https://client.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-stainless-os, authorization" },
    });
    const response = await route.OPTIONS(request);
    const advertised = response.headers.get("Access-Control-Allow-Methods").split(/\s*,\s*/).sort();
    expect(advertised).toEqual(methods.filter((method) => typeof route[method] === "function").sort());
    const allowed = response.headers.get("Access-Control-Allow-Headers").split(/\s*,\s*/).map((header) => header.toLowerCase());
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("*");
    for (const header of request.headers.get("Access-Control-Request-Headers").split(/\s*,\s*/)) {
      expect(allowed.includes(header) || (header !== "authorization" && allowed.includes("*"))).toBe(true);
    }
  });
});
