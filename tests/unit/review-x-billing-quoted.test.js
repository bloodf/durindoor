import { describe, expect, it } from "vitest";
import { createBillingNoticeGate } from "../../open-sse/utils/billingNotice.js";

function notice(text) {
  const gate = createBillingNoticeGate("pollinations");
  gate.push({ choices: [{ delta: { content: text } }] });
  return gate.notice();
}

describe("quoted billing refusals", () => {
  it.each([
    'The error message is "Insufficient credits".',
    "The error message is 'Insufficient credits'.",
    "It said `Please top up`.",
    "The error was “Out of funds”.",
  ])("releases an answer quoting a refusal: %s", (text) => {
    expect(notice(text)).toBeNull();
  });

  it.each([
    "Insufficient credits",
    '"Insufficient credits"',
    'Error: "Insufficient credits"',
    "You don't have enough credits. Please top up.",
  ])("recognizes a refusal: %s", (text) => {
    expect(notice(text)).toBe(text);
  });

  it.each([
    'Request failed: "Insufficient balance" (code 402)',
    'Upstream error: "insufficient credits", please contact support',
    "Insufficient credits. Please top up.",
    "Error 402: 'Insufficient credits'",
    'Request failed with status 429: "Insufficient balance"',
  ])("recognizes a refusal that quotes its error: %s", (text) => {
    expect(notice(text)).toBe(text);
  });

  it.each([
    'The error message is "Insufficient credits" and it usually means the account needs funds.',
    'When a request fails, the API may say "Insufficient balance"; check your billing page.',
  ])("releases an answer that discusses a quoted refusal: %s", (text) => {
    expect(notice(text)).toBeNull();
  });
});
