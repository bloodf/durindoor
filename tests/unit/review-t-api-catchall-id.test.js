import { describe, expect, it } from "vitest";
import { GET } from "../../src/app/api/[...catchAll]/route.js";
import { jsonNotFoundResponse } from "open-sse/translator/validate.js";

describe("/api catch-all request correlation", () => {
  it("preserves the unknown path response and adds a request id", async () => {
    const request = new Request("https://durindoor.test/api/unknown/path");
    const expected = await jsonNotFoundResponse(request);
    const response = await GET(request);

    expect(response.status).toBe(expected.status);
    expect(await response.text()).toBe(await expected.text());
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
