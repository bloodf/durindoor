import { describe, expect, it } from "vitest";
import { createBillingNoticeGate } from "../../open-sse/utils/billingNotice.js";

function notice(text) {
  const gate = createBillingNoticeGate("pollinations");
  gate.push({ choices: [{ delta: { content: text } }] });
  return gate.notice();
}

describe("quoted billing refusals inside an error frame", () => {
  it.each([
    'Request failed: "Insufficient balance" (code 402)',
    'Upstream error: "insufficient credits", please contact support',
    "Insufficient credits. Please top up.",
    "Error 402: 'Insufficient credits'",
    'Request failed with status 429: "Insufficient balance"',
  ])("recognizes a refusal that quotes its error: %s", (text) => {
    expect(notice(text)).toBe(text);
  });

  // #2594: answers that quote a billing phrase are not refusals.
  it.each([
    'The error message is "Insufficient credits".',
    "The error message is 'Insufficient credits'.",
    "It said `Please top up`.",
    "The error was “Out of funds”.",
    'The error message is "Insufficient credits" and it usually means the account needs funds.',
    'When a request fails, the API may say "Insufficient balance"; check your billing page.',
  ])("releases an answer that quotes a refusal: %s", (text) => {
    expect(notice(text)).toBeNull();
  });

  // #2594: refusals that are only the quoted phrase, or a bare label around it.
  it.each([
    "Insufficient credits",
    '"Insufficient credits"',
    'Error: "Insufficient credits"',
    "You don't have enough credits. Please top up.",
  ])("recognizes a refusal: %s", (text) => {
    expect(notice(text)).toBe(text);
  });
});
