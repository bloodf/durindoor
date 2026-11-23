import { describe, expect, it } from "vitest";
import * as chat from "@/app/api/v1/chat/completions/route.js";
import * as messages from "@/app/api/v1/messages/route.js";
import * as responses from "@/app/api/v1/responses/route.js";

const routes = [
  ["/v1/chat/completions", chat],
  ["/v1/messages", messages],
  ["/v1/responses", responses],
];

describe("review r-cors", () => {
  it.each(routes)("advertises exactly the exported methods for %s", async (_path, route) => {
    const response = await route.OPTIONS();
    const advertised = response.headers.get("Access-Control-Allow-Methods").split(", ").sort();
    const exported = Object.keys(route).filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(name)).sort();
    expect(advertised).toEqual(exported);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Headers")).not.toBe("*");
  });
});
