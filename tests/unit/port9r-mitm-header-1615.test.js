import { expect, it } from "vitest";
import server from "../../src/mitm/server.js";

it("removes the local loop marker from upstream headers without changing the incoming headers", () => {
  const incoming = { host: "cloudcode-pa.googleapis.com", "X-Request-Source": "local", authorization: "Bearer token" };
  expect(server.upstreamHeaders(incoming, "daily-cloudcode-pa.googleapis.com")).toEqual({
    host: "daily-cloudcode-pa.googleapis.com", authorization: "Bearer token",
  });
  expect(incoming["X-Request-Source"]).toBe("local");
});
