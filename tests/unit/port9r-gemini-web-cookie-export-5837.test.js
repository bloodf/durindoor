// Synthetic cookie values only; nothing here was issued by Google and nothing is fetched.
import { describe, expect, it } from "vitest";

import { normalizeGeminiCookieInput, normalizeGeminiValidationCookie } from "../../open-sse/executors/gemini-web.js";

const HEADER = "__Secure-1PSID=psid-val; __Secure-1PSIDTS=ts-val";
const cookie = (name, value, domain = ".google.com") => ({ name, value, domain, path: "/" });
const EXPORT = [cookie("__Secure-1PSID", "psid-val"), cookie("__Secure-1PSIDTS", "ts-val", "gemini.google.com")];

describe("9router#5837 Gemini Web Cookie-Editor JSON import", () => {
  it.each([
    ["a Cookie-Editor array", EXPORT],
    ["a { cookies: [...] } export", { cookies: EXPORT }],
    ["entries without a domain", EXPORT.map(({ name, value }) => ({ name, value }))],
  ])("turns %s into a Cookie header", (_label, input) => {
    const raw = JSON.stringify(input, null, 2);
    expect(normalizeGeminiCookieInput(raw)).toBe(HEADER);
    expect(normalizeGeminiValidationCookie(raw)).toBe(HEADER);
  });

  it("drops cookies that gemini.google.com would never receive", () => {
    const raw = JSON.stringify([
      ...EXPORT,
      cookie("OTHER", "x", ".example.com"),
      cookie("LOOKALIKE", "x", "evilgoogle.com"),
      cookie("ACCOUNTS", "x", "accounts.google.com"),
    ]);
    expect(normalizeGeminiCookieInput(raw)).toBe(HEADER);
  });

  it("drops entries that cannot be written into a Cookie header", () => {
    const raw = JSON.stringify([
      ...EXPORT,
      cookie("SPLIT", "a; __Secure-1PSID=other"),
      cookie("CRLF", "a\r\nX-Injected: 1"),
      cookie("bad=name", "x"),
      cookie("NUMBER", 7),
      null,
    ]);
    expect(normalizeGeminiCookieInput(raw)).toBe(HEADER);
  });

  it.each(["[]", JSON.stringify([cookie("__Secure-1PSID", "x", ".example.com")]), JSON.stringify({ cookies: [] })])(
    "rejects an export with no usable cookie instead of treating the JSON as a PSID: %s",
    (raw) => {
      expect(normalizeGeminiCookieInput(raw)).toBe("");
      expect(normalizeGeminiValidationCookie(raw)).toBeNull();
    },
  );
});
