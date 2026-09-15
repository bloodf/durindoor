/**
 * Contract test against the REAL installed pxpipe-proxy package.
 *
 * Every other pxpipe test injects a double: `pxpipe-loader-dispatch` passes a
 * `vi.fn()` transform and `pxpipe-install-detection` only asserts that some
 * entry file exists. So the actual export shape `open-sse/rtk/pxpipe.js`
 * depends on could change under a version bump while the suite stays green.
 *
 * This pins what the production code genuinely requires of the package:
 *  - it resolves through the repo's own on-disk loader, not a bare specifier
 *    (pxpipe-proxy is ESM-only with no root export, so `require("pxpipe-proxy")`
 *    throws ERR_PACKAGE_PATH_NOT_EXPORTED and proves nothing);
 *  - the resolved module exports a callable `transformAnthropicMessages`.
 */
import { describe, expect, it } from "vitest";
import { getInstallInfo, libraryEntry } from "../../src/lib/pxpipe/install.js";

describe("pxpipe-proxy package contract", () => {
  it("is detected as installed with a resolvable library entry", () => {
    const info = getInstallInfo();
    expect(info.installed).toBe(true);
    expect(info.version).toBeTruthy();
    expect(libraryEntry()).toBeTruthy();
  });

  it("exports the transform the rtk stage calls", async () => {
    const entry = libraryEntry();
    const mod = await import(entry);

    // open-sse/rtk/pxpipe.js is handed this function as `transform` and calls
    // it directly; a rename or a default-only export would break compression
    // silently, because the stage is fail-open.
    expect(typeof mod.transformAnthropicMessages).toBe("function");
  });

  it("returns the documented result shape the rtk stage destructures", async () => {
    const { transformAnthropicMessages } = await import(libraryEntry());

    // An unsupported model short-circuits before any rendering, so this
    // exercises the real function deterministically with no image work and no
    // I/O — while still proving the result shape open-sse/rtk/pxpipe.js reads.
    const body = new TextEncoder().encode(
      JSON.stringify({ model: "not-a-pxpipe-model", messages: [{ role: "user", content: "hi" }] }),
    );
    const result = await transformAnthropicMessages({ body, model: "not-a-pxpipe-model" });

    expect(result).toMatchObject({ applied: false, reason: "unsupported_model" });
    // `body` is passed straight back through; the stage substitutes it only
    // when `applied` is true, so an undefined body here would break fail-open.
    expect(result.body).toBeInstanceOf(Uint8Array);
    expect(result.info).toBeDefined();
    expect(result.cache).toMatchObject({ ownsCacheControl: false });
  });
});
