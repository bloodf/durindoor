import { describe, expect, it } from "vitest";
import * as legacy from "../../open-sse/translator/validate.js";
import * as responses from "../../open-sse/translator/http-responses.js";

describe("translator HTTP response helpers", () => {
  it("keeps the original exports as synchronous aliases", () => {
    for (const name of ["jsonNotFoundResponse", "headOkResponse", "headNotFoundResponse"]) {
      expect(legacy[name]).toBe(responses[name]);
    }
  });

  it("returns the pathname in the JSON 404 without query or fragment", async () => {
    const response = legacy.jsonNotFoundResponse(new Request("https://example.com/v1/missing?key=value#fragment"));
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      error: {
        message: "Unknown API route: /v1/missing",
        type: "not_found",
        code: "unknown_route",
        path: "/v1/missing",
      },
    });
  });

  it.each([["headOkResponse", 200], ["headNotFoundResponse", 404]])(
    "%s returns headers and no body",
    async (name, status) => {
      const response = legacy[name]();
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.body).toBeNull();
      expect(await response.text()).toBe("");
    }
  );
});
