import { describe, expect, it } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";

describe("OmniRoute a10488825667eb847e83113d6eecf9bdc01863ed CodeBuddy CLI identity", () => {
  it("sends the international CLI identity without changing China requests", async () => {
    const identities = {};
    for (const provider of ["codebuddy-intl", "codebuddy-cn"]) {
      await getExecutor(provider).execute({
        model: "test", body: { messages: [] }, stream: true,
        credentials: { apiKey: "synthetic-key" },
        directFetch: async (_url, init) => {
          identities[provider] = init.headers;
          return new Response("denied", { status: 401 });
        },
        requestPolicy: { maxTransportAttempts: 1 },
      });
    }
    expect(identities["codebuddy-intl"]).toMatchObject({
      "User-Agent": "CLI/2.175.0 CodeBuddy/2.175.0",
      "X-IDE-Type": "CLI", "X-IDE-Name": "CLI", "X-IDE-Version": "2.175.0",
    });
    expect(identities["codebuddy-cn"]["X-IDE-Version"]).toBeUndefined();
  });
});
