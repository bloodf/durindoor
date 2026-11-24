import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function fetchWithBasePath(basePath, url) {
  const calls = [];
  const window = {
    location: { href: `https://example.test${basePath}/dashboard`, origin: "https://example.test" },
    fetch: (input) => calls.push(input),
    EventSource: class {},
  };
  runInNewContext(readFileSync(new URL("../../public/base-path-bootstrap.js", import.meta.url), "utf8"), {
    document: { currentScript: { dataset: { basePath } } },
    window,
    URL,
    Request,
  });
  window.fetch(url);
  return calls[0];
}

describe("i18n base path", () => {
  it("fetches non-English translations under the configured base path", () => {
    expect(fetchWithBasePath("/router", "/i18n/literals/vi.json"))
      .toBe("https://example.test/router/i18n/literals/vi.json");
  });

  it("keeps the translation URL unchanged when no base path is configured", () => {
    expect(fetchWithBasePath("", "/i18n/literals/vi.json"))
      .toBe("/i18n/literals/vi.json");
  });
});
