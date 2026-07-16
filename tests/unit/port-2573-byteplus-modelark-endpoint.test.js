import { describe, expect, it } from "vitest";
import byteplus from "../../open-sse/providers/registry/byteplus.js";

// Port of decolua/9router#2573: BytePlus ModelArk free-tier endpoint moved
// from `/api/coding/v3` to `/api/v3`.
describe("byteplus provider registry (port upstream #2573)", () => {
  it("targets the BytePlus ModelArk free-tier /api/v3 endpoint", () => {
    expect(byteplus.transport.baseUrl).toBe(
      "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
    );
  });
});
