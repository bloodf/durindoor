/**
 * The endpoint dashboard displayed every URL inside a fixed-width readonly
 * <input>. An input clips anything wider than the field and offers no wrap, so
 * `http://localhost:11434/v1` read as `http://localhost:1143` and a tunnel
 * hostname as `https://tim-rpg-phili`. The value was complete and copyable the
 * whole time — it simply could not be read.
 *
 * These guards pin the observable contract of an endpoint row: the full URL is
 * present as text, and it is not rendered in an element that clips it.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EndpointRow from "../../src/app/(dashboard)/dashboard/endpoint/components/EndpointRow";

const LONG_URL = "https://tim-rpg-philippines-restoration.trycloudflare.com/v1";

const render = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(EndpointRow, {
      label: "Tunnel",
      url: LONG_URL,
      copyId: "tunnel_url",
      copied: null,
      onCopy: () => {},
      badge: "CF",
      ...props,
    }),
  );

describe("endpoint URL visibility", () => {
  it("renders the whole URL as readable text", () => {
    const html = render();
    // The complete URL must appear as document text, not only as an attribute
    // value that a fixed-width control would visually truncate.
    expect(html).toContain(`>${LONG_URL}<`);
  });

  it("does not put the URL in a control that clips it", () => {
    const html = render();
    expect(html).not.toMatch(/<input[^>]*value="https:/);
    expect(html).not.toContain("readonly");
  });

  it("allows the URL to wrap instead of overflowing its row", () => {
    const html = render();
    // break-all lets a long hostname wrap; without it the row overflows and the
    // tail of the URL is unreachable at narrow widths.
    expect(html).toMatch(/break-all/);
  });

  it("still exposes the URL to assistive tech and the copy action", () => {
    const html = render({ label: "Tailscale" });
    expect(html).toContain('aria-label="Tailscale endpoint"');
    expect(html).toContain('aria-label="Copy Tailscale endpoint"');
  });

  it("swaps the copy icon to a checkmark for the copied row only", () => {
    expect(render({ copied: "tunnel_url" })).toContain(">check<");
    expect(render({ copied: "other_row" })).toContain(">content_copy<");
  });

  // EndpointPageClient renders four more URL rows inline (tunnel and Tailscale,
  // each direct and external) plus the Cloudflare list. They are not reachable
  // by renderToStaticMarkup — the component drives tunnel/Tailscale polling
  // effects and this repo has no jsdom harness — so they are guarded at the
  // source level, matching endpoint-page-client-regression.test.js. Without
  // this, reverting any one of them leaves a user-visible clipped URL while the
  // shared-row tests above still pass.
  describe("inline endpoint rows in EndpointPageClient", () => {
    const SRC = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    const INLINE_URL_LABELS = [
      "External tunnel URL",
      "Cloudflare tunnel URL",
      "External Tailscale URL",
      "Tailscale URL",
    ];

    it.each(INLINE_URL_LABELS)("renders %s as wrapping text, not a clipping input", (label) => {
      // The element carrying this aria-label must be a span that wraps.
      const element = SRC.match(
        new RegExp(`<(\\w+)[^>]*?aria-label="${label}"[^>]*?>`, "s"),
      );
      expect(element, `no element found for aria-label="${label}"`).not.toBeNull();
      expect(element[1]).toBe("span");
      expect(element[0]).toMatch(/break-all/);
    });

    it("renders the Cloudflare endpoint list entries as wrapping text", () => {
      const element = SRC.match(
        /<(\w+)[^>]*?aria-label=\{`Cloudflare endpoint \$\{u\}`\}[^>]*?>/s,
      );
      expect(element, "no element found for the Cloudflare endpoint list row").not.toBeNull();
      expect(element[1]).toBe("span");
      expect(element[0]).toMatch(/break-all/);
    });

    it("leaves no readonly input holding an endpoint URL", () => {
      const readonlyInputs = SRC.match(/<Input\b[^>]*\breadOnly\b[^>]*>/gs) || [];
      expect(readonlyInputs).toHaveLength(0);
    });
  });
});
