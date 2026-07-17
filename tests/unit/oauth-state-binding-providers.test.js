import { describe, expect, it } from "vitest";

import { generateAuthData } from "../../src/lib/oauth/providers.js";

describe.each(["cline", "clinepass"])("%s OAuth state binding", (provider) => {
  it("places the generated state in the authorization request", async () => {
    const auth = await generateAuthData(
      provider,
      "http://localhost:20127/callback",
      undefined,
      { disableEnvProxy: true },
    );
    const url = new URL(auth.authUrl);

    expect(auth.state).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(url.searchParams.get("callback_url")).toBe("http://localhost:20127/callback");
  });
});
