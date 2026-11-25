import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchZedAuthenticatedUser } from "../../open-sse/shared/zedHostedAuth.js";

const root = resolve(import.meta.dirname, "../..");

describe("Zed shared auth layer", () => {
  it("does not import gateway utilities or services", () => {
    const sharedDir = resolve(root, "open-sse/shared");
    const offenders = readdirSync(sharedDir)
      .filter((name) => name.endsWith(".js"))
      .filter((name) => /from\s*["']\.\.\/(?:utils|services)\//.test(readFileSync(resolve(sharedDir, name), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("uses an injected fetch transport", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "zed-user" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const result = await fetchZedAuthenticatedUser(
      { accessToken: "synthetic-token", providerSpecificData: { userId: "zed-user" } },
      { fetch }
    );
    expect(result).toEqual({ id: "zed-user" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("https://cloud.zed.dev/client/users/me");
  });
});
