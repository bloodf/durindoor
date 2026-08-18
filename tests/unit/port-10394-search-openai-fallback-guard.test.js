import { describe, it, expect } from "vitest";
import {
  getExecutor,
  hasSpecializedExecutor,
} from "../../open-sse/executors/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

// Port of OmniRoute PR #10394 "fix(chat): guard search providers from OpenAI fallback".
// Source test: open-sse/tests/unit/search-providers-chat-guard.test.ts (om-pr-10394).
// Adaptation: there is no `open-sse/config/searchRegistry.ts` in this fork; the
// equivalent surface is the file-per-provider REGISTRY array. Search-only providers
// are entries that declare `searchConfig` but have no `transport` block — these
// must NEVER be reachable through the chat-completions path; doing so silently
// falls through to DefaultExecutor → PROVIDERS.openai and leaks the user's real
// search API key (e.g. a Tavily `tvly-...` key) to api.openai.com.

const SEARCH_PROVIDER_IDS = REGISTRY
  .filter((entry) => entry.searchConfig && !entry.transport)
  .map((entry) => entry.id);

const SEARCH_PROVIDER_ALIASES = REGISTRY
  .filter((entry) => entry.searchConfig && !entry.transport)
  .flatMap((entry) => [
    entry.alias,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
  ])
  .filter(Boolean);

describe("port #10394: search providers must not fall through to OpenAI", () => {
  it("has no specialized chat executor for any search provider id", () => {
    expect(SEARCH_PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const id of SEARCH_PROVIDER_IDS) {
      expect(hasSpecializedExecutor(id)).toBe(false);
    }
  });

  it("throws 400 when a search provider id is routed through getExecutor()", () => {
    for (const id of SEARCH_PROVIDER_IDS) {
      let caught;
      try {
        getExecutor(id);
      } catch (e) {
        caught = e;
      }
      expect(caught, `getExecutor("${id}") should have thrown`).toBeDefined();
      expect(caught.status).toBe(400);
      expect(caught.message).toMatch(/search provider/i);
      // The error must mention the actual provider id so the user can diagnose
      // their model mapping; the DefaultExecutor path that produced the prior
      // `Incorrect API key provided: tvly-...` gave no signal at all.
      expect(caught.message).toContain(id);
    }
  });

  it("throws 400 for known search provider aliases too (not just ids)", () => {
    // Real-world model mapping may pass the alias string ("tavily-search")
    // straight through getExecutor() before any id normalization; the guard
    // must catch this case rather than letting it fall through to OpenAI.
    expect(SEARCH_PROVIDER_ALIASES.length).toBeGreaterThan(0);
    for (const alias of SEARCH_PROVIDER_ALIASES) {
      let caught;
      try {
        getExecutor(alias);
      } catch (e) {
        caught = e;
      }
      expect(caught, `getExecutor("${alias}") should have thrown`).toBeDefined();
      expect(caught.status).toBe(400);
    }
  });

  it("does not regress chat-capable providers that also expose searchConfig", () => {
    // ollama and perplexity have BOTH searchConfig and transport; they are
    // real chat-completions providers and must not be blocked by the guard.
    const chatCapableWithSearch = REGISTRY
      .filter((entry) => entry.searchConfig && entry.transport)
      .map((entry) => entry.id);
    for (const id of chatCapableWithSearch) {
      // Should NOT throw; either returns a specialized executor or returns
      // a DefaultExecutor (key check: no 400 search-provider error).
      let caught;
      let executor;
      try {
        executor = getExecutor(id);
      } catch (e) {
        caught = e;
      }
      expect(caught, `getExecutor("${id}") should NOT throw`).toBeUndefined();
      expect(executor).toBeDefined();
      expect(typeof executor.execute).toBe("function");
    }
  });
});
