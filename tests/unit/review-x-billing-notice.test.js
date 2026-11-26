import { describe, expect, it } from "vitest";
import { createBillingNoticeGate } from "../../open-sse/utils/billingNotice.js";

function notice(text) {
  const gate = createBillingNoticeGate("pollinations");
  gate.push({ choices: [{ delta: { content: text } }] });
  return gate.notice();
}

describe("billing notice false positives", () => {
  it("releases a positive answer about credits", () => {
    expect(notice("Yes, you have enough credits for that.")).toBeNull();
  });

  it("releases an answer that merely mentions a refusal", () => {
    expect(notice("If you see insufficient credits, check your account settings. You can also review your usage history and choose a plan that fits your needs.")).toBeNull();
  });

  it.each([
    "The account behind this API key doesn't have enough credits. Please top up or complete a quest, then try again.",
    "Insufficient credits",
    "Insufficient balance",
    "Please top up",
    "Top up to continue",
    "Purchase more credits",
    "Credit balance is too low",
    "Credit balance exhausted",
    "Recharge your account",
    "Out of funds",
  ])("recognizes a billing refusal: %s", (text) => {
    expect(notice(text)).toBe(text);
  });
});
