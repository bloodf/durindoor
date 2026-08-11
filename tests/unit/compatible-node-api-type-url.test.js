// An OpenAI-compatible node stores its API type (`apiType: "chat" | "responses"`)
// and the dashboard lets it be edited after creation. buildUrl used to infer the
// endpoint from a substring of the provider id, so a node created as
// "…-responses-…" and later switched to Chat Completions kept dispatching to
// /responses — every request 404s or is misinterpreted by the upstream.
import { describe, expect, it } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";

const BASE_URL = "https://compat.example.com/v1";

function url(providerId, apiType) {
  const executor = new BaseExecutor(providerId, {});
  return executor.buildUrl("some-model", false, 0, {
    providerSpecificData: { baseUrl: BASE_URL, ...(apiType ? { apiType } : {}) },
  });
}

describe("openai-compatible node endpoint selection", () => {
  it("follows the stored apiType over the provider id", () => {
    expect(url("openai-compatible-responses-abc", "chat")).toBe(`${BASE_URL}/chat/completions`);
    expect(url("openai-compatible-chat-abc", "responses")).toBe(`${BASE_URL}/responses`);
  });

  it("agrees with the stored apiType when the id already matches", () => {
    expect(url("openai-compatible-responses-abc", "responses")).toBe(`${BASE_URL}/responses`);
    expect(url("openai-compatible-chat-abc", "chat")).toBe(`${BASE_URL}/chat/completions`);
  });

  it("falls back to the id heuristic when no apiType is stored", () => {
    expect(url("openai-compatible-responses-abc")).toBe(`${BASE_URL}/responses`);
    expect(url("openai-compatible-chat-abc")).toBe(`${BASE_URL}/chat/completions`);
  });

  it("leaves anthropic-compatible nodes on the messages endpoint", () => {
    expect(url("anthropic-compatible-abc", "responses")).toBe(`${BASE_URL}/messages`);
  });
});
