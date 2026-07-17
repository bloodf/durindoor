// Locks the connect-timeout classification + skip-rule retry policy in BaseExecutor (9router #2588).
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { matchSkipRule, resolveRequestRetryPolicy, findMatchingSkipRule, resolveProviderHeaderTimeout } = await import("../../open-sse/config/runtimeConfig.js");

const creds = { apiKey: "k" };

// Tiny retry delays so the suite stays fast; attempts come from the merged
// DEFAULT_RETRY_CONFIG + this config, capped by maxTransportAttempts.
const fastRetry = { 502: { attempts: 5, delayMs: 1 } };

// Upstream that never returns headers: settles ONLY when the merged abort signal
// fires (our connect timer). undici rejects with the abort REASON object, so
// error.name stays "Error" — the whole point of the closure-flag fix.
function hangingFetch(url, opts) {
  const sig = opts?.signal;
  if (!sig) throw new Error("proxyAwareFetch called without a signal — base.js must always pass one");
  return new Promise((_resolve, reject) => {
    const onAbort = () => reject(sig.reason || new Error("aborted"));
    if (sig.aborted) return onAbort();
    sig.addEventListener("abort", onAbort, { once: true });
  });
}

// An HTTP error whose body carries text a `contains` rule matches. The mock's
// clone() yields a readable body; base.js must read it (bounded) to drive policy.
function httpErrorWithBody(status, bodyText) {
  return () => Promise.resolve({
    status,
    headers: { get: () => "application/json" },
    clone: () => ({ text: () => Promise.resolve(bodyText) }),
  });
}

beforeEach(() => { fetchMock.mockReset(); });

describe("runtimeConfig skip-rule matching", () => {
  const rules = [
    { provider: "p", match: { status: 503, contains: "capacity" }, action: "skip" },
    { provider: "p", match: { kind: "connect_timeout" }, action: "retry" },
  ];

  it("ANDs conditions; first matching rule wins; empty match never matches", () => {
    expect(matchSkipRule("p", { status: 503, errorKind: "http_503", text: "at capacity now" }, rules)?.action).toBe("skip");
    expect(matchSkipRule("p", { status: 503, errorKind: "http_503", text: "plain error" }, rules)).toBeNull();
    expect(matchSkipRule("p", { errorKind: "connect_timeout" }, rules)?.action).toBe("retry");
    expect(matchSkipRule("other", { status: 503, text: "capacity" }, rules)).toBeNull();
    expect(matchSkipRule("p", { status: 500 }, [{ provider: "p", match: {}, action: "skip" }])).toBeNull();
  });

  it("malformed action never matches and cannot shadow a later valid rule", () => {
    const mixed = [
      { provider: "p", match: { status: 502 }, action: "bogus" },
      { provider: "p", match: { status: 502 }, action: "skip" },
    ];
    expect(matchSkipRule("p", { status: 502 }, mixed)?.action).toBe("skip");
  });

  it("no requestPolicy resolves nulls (pre-port behavior preserved)", () => {
    expect(resolveRequestRetryPolicy("p", null)).toEqual({
      maxTransportAttempts: null, skipRules: null, headerTimeoutMs: null, hasContainsRule: false,
    });
  });

  it("preserves full rule shape: headerTimeoutMs passes through; sweep only on skip", () => {
    const skip = matchSkipRule("p", { status: 503, text: "capacity" }, [
      { provider: "p", match: { status: 503, contains: "capacity" }, action: "skip", headerTimeoutMs: 5000, sweep: true },
    ]);
    expect(skip).toEqual({ action: "skip", headerTimeoutMs: 5000, sweep: true });
    // sweep is dropped for retry rules (only meaningful for skip)
    const retry = matchSkipRule("p", { errorKind: "connect_timeout" }, [
      { provider: "p", match: { kind: "connect_timeout" }, action: "retry", sweep: true },
    ]);
    expect(retry).toEqual({ action: "retry" });
  });

  it("findMatchingSkipRule returns the raw rule object", () => {
    const rule = { provider: "p", match: { status: 429 }, action: "retry", custom: 1 };
    expect(findMatchingSkipRule("p", { status: 429 }, [rule])).toBe(rule);
  });

  it("resolveProviderHeaderTimeout reads connect_timeout rule config before any attempt", () => {
    const rules = [
      { provider: "p", match: { kind: "connect_timeout" }, action: "retry", headerTimeoutMs: 8000 },
      { provider: "p", match: { status: 503 }, action: "skip" },
    ];
    // No failure needed — resolved from rule config, first connect_timeout rule wins
    expect(resolveProviderHeaderTimeout("p", rules)).toBe(8000);
    expect(resolveProviderHeaderTimeout("p", [{ provider: "p", match: { status: 503 }, action: "skip" }])).toBeNull();
    expect(resolveProviderHeaderTimeout("other", rules)).toBeNull();
  });
});

describe("BaseExecutor connect timeout", () => {
  it("classifies header-timeout via closure flag (NOT error.name); 0 in-place retries by default", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: fastRetry });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 2, skipRules: [], headerTimeoutMs: 40 },
    }).catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.errorKind).toBe("connect_timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 8000);

  it("retries same account for connect_timeout when a retry rule matches", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: fastRetry });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 3,
        skipRules: [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "retry" }],
        headerTimeoutMs: 25,
      },
    }).catch(e => e);

    expect(err.errorKind).toBe("connect_timeout");
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  }, 8000);

  it("rule-level headerTimeoutMs reaches the policy and drives the retry count", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: fastRetry });
    const skipRules = [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "retry", headerTimeoutMs: 30 }];

    // Rule-level timeout flows into the resolved policy (no policy-level value).
    expect(resolveRequestRetryPolicy("kr-ac", { maxTransportAttempts: 2, skipRules }).headerTimeoutMs).toBe(30);

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 2, skipRules }, // no policy-level headerTimeoutMs
    }).catch(e => e);

    expect(err.errorKind).toBe("connect_timeout"); // rule timeout fired, classified
    // retry rule + cap 2 → exactly 2 fetches (1 + 1 retry).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 8000);

  it("does not classify a real HTTP 502 as connect_timeout", async () => {
    fetchMock.mockResolvedValue({ status: 502, headers: { get: () => "" } });
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: fastRetry });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 1, skipRules: [], headerTimeoutMs: 5000 },
    });
    expect(out.response.status).toBe(502);
  }, 8000);
});

describe("BaseExecutor contains-rule drives transport retry", () => {
  it("action:retry on a matching body substring retries maxTransportAttempts-1 times", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(500, '{"error":"Server OVERLOADED, try later"}'));
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: fastRetry });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 3,
        skipRules: [{ provider: "prov-x", match: { contains: "overloaded" }, action: "retry" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(out.response.status).toBe(500);
  }, 8000);

  it("action:skip on a matching body substring returns the SAME response object, 0 retries", async () => {
    const response = {
      status: 500,
      headers: { get: () => "application/json" },
      clone: () => ({ text: () => Promise.resolve("upstream is overloaded right now") }),
    };
    fetchMock.mockResolvedValue(response);
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: fastRetry });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 3,
        skipRules: [{ provider: "prov-x", match: { contains: "overloaded" }, action: "skip" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // skip → no in-place retry
    expect(out.response).toBe(response); // unchanged original response
  }, 8000);

  it("aborts the request when the caller aborts during the body probe", async () => {
    const caller = new AbortController();
    // Body probe hangs until the caller aborts.
    fetchMock.mockResolvedValue({
      status: 500,
      headers: { get: () => "application/json" },
      clone: () => ({ text: () => new Promise((_r, reject) => {
        caller.signal.addEventListener("abort", () => {
          const e = new Error("aborted"); e.name = "AbortError"; reject(e);
        }, { once: true });
      }) }),
    });
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: fastRetry });

    const pending = ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      signal: caller.signal,
      requestPolicy: {
        maxTransportAttempts: 2,
        skipRules: [{ provider: "prov-x", match: { contains: "overloaded" }, action: "retry" }],
      },
    });
    setTimeout(() => caller.abort(), 20);
    const err = await pending.catch(e => e);
    expect(err?.name).toBe("AbortError"); // propagated, not swallowed into a silent response
  }, 8000);

  it("does NOT read the body when no contains-rule applies to this provider", async () => {
    let cloned = 0;
    fetchMock.mockImplementation(() => Promise.resolve({
      status: 500,
      headers: { get: () => "application/json" },
      clone: () => { cloned++; return { text: () => Promise.resolve("overloaded") }; },
    }));
    const ex = new BaseExecutor("prov-y", { baseUrl: "https://x/api", retry: fastRetry });

    await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 2,
        // contains rule is for a DIFFERENT provider → must not trigger a body read here
        skipRules: [{ provider: "other", match: { contains: "overloaded" }, action: "retry" }],
      },
    });
    expect(cloned).toBe(0);
  }, 8000);
});

describe("BaseExecutor error classification + policy isolation", () => {
  it("classifies a generic fetch failure (ECONNRESET) as network, not connect_timeout", async () => {
    fetchMock.mockImplementation(() => {
      const e = new Error("read ECONNRESET");
      e.code = "ECONNRESET";
      return Promise.reject(e);
    });
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: fastRetry });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 1, skipRules: [], headerTimeoutMs: 5000 },
    }).catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.errorKind).toBe("network");
  }, 8000);

  it("two concurrent executes with different policies do not bleed timeouts/retries", async () => {
    // A: 30ms header timeout, no retry → 1 call, connect_timeout.
    // B: 200ms header timeout + retry rule maxTransportAttempts 3 → 3 calls, connect_timeout.
    // Shared singleton executor; policy must be per-call (never on this.config).
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: fastRetry });

    const pA = ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 2, skipRules: [], headerTimeoutMs: 30 },
    }).catch(e => e);
    const pB = ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 3,
        skipRules: [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "retry" }],
        headerTimeoutMs: 200,
      },
    }).catch(e => e);

    const [errA, errB] = await Promise.all([pA, pB]);
    expect(errA.errorKind).toBe("connect_timeout");
    expect(errB.errorKind).toBe("connect_timeout");
    // A: 1 call (no retry). B: 3 calls (1 + 2 retries). Total 4 — proves no cross-bleed.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 8000);
});

describe("BaseExecutor skip-rule abandons account without cycling base URLs", () => {
  const THREE_URLS = ["https://a/api", "https://b/api", "https://c/api"];

  it("HTTP skip: does NOT cycle the remaining base URLs on the same account", async () => {
    // 429 that WITHOUT a skip rule would cycle all 3 URLs (shouldRetry on 429).
    fetchMock.mockImplementation(httpErrorWithBody(429, "rate limited"));
    const ex = new BaseExecutor("kr", { baseUrls: THREE_URLS, retry: fastRetry });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 2,
        skipRules: [{ provider: "kr", match: { status: 429 }, action: "skip" }],
      },
    });
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one URL only, then abandon account
  }, 8000);

  it("exception skip: rethrows the SAME error, does NOT cycle remaining base URLs", async () => {
    const boom = new Error("read ECONNRESET");
    fetchMock.mockImplementation(() => Promise.reject(boom));
    const ex = new BaseExecutor("kr", { baseUrls: THREE_URLS, retry: fastRetry });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 2,
        skipRules: [{ provider: "kr", match: { kind: "network" }, action: "skip" }],
      },
    }).catch(e => e);
    expect(err).toBe(boom); // identical error object
    expect(err.errorKind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1); // abandoned after the first URL
  }, 8000);

  it("no requestPolicy → pre-port bounds preserved: 502 retries 3x on one URL, no cap", async () => {
    fetchMock.mockResolvedValue({ status: 502, headers: { get: () => "" } });
    const ex = new BaseExecutor("kr", { baseUrl: "https://a/api", retry: { 502: { attempts: 3, delayMs: 1 } } });

    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(502);
    // 1 initial + 3 retries = 4 — DEFAULT/config attempts alone decide; no policy cap.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 8000);

  it("retry-rule overrides zero base attempts: 500 retries maxTransportAttempts-1 then exhausts", async () => {
    // 500 has NO DEFAULT_RETRY_CONFIG entry (base attempts = 0 → would never retry).
    fetchMock.mockResolvedValue({ status: 500, headers: { get: () => "" } });
    const ex = new BaseExecutor("kr", { baseUrl: "https://a/api", retry: {} });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 2,
        skipRules: [{ provider: "kr", match: { status: 500 }, action: "retry" }],
      },
    });
    expect(out.response.status).toBe(500);
    // rule retry → cap-1 = 1 retry, then exhausted (retryAttemptsByUrl reaches cap).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 8000);

  it("no skip rule → still cycles all base URLs (unchanged default behavior)", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("read ECONNRESET")));
    const ex = new BaseExecutor("kr", { baseUrls: THREE_URLS, retry: fastRetry });

    await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 1, skipRules: [] },
    }).catch(e => e);
    expect(fetchMock).toHaveBeenCalledTimes(3); // all three URLs tried
  }, 8000);
});

describe("BaseExecutor retry-rule vs subclass computeRetryDelay hook", () => {
  // Dev's AntigravityExecutor.computeRetryDelay returns false for 503 capacity
  // (the hardcode upstream #2588 deleted). Base converts ONLY that exact veto
  // when a matching explicit retry-rule exists; every other hook verdict stands.
  class VetoExecutor extends BaseExecutor {
    async computeRetryDelay() { return false; }
  }

  it("antigravity 503 capacity + explicit retry rule bypasses the capacity veto", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(503, "MODEL_CAPACITY_EXHAUSTED: at capacity"));
    const ex = new VetoExecutor("antigravity", { baseUrl: "https://x/api", retry: fastRetry });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 2,
        skipRules: [{ provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "retry" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 + 1 retry despite capacity veto
    expect(out.response.status).toBe(503);
  }, 8000);

  it("no matching rule → capacity veto still applies (antigravity fail-fast preserved)", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(503, "MODEL_CAPACITY_EXHAUSTED: at capacity"));
    const ex = new VetoExecutor("antigravity", { baseUrl: "https://x/api", retry: { 503: { attempts: 5, delayMs: 1 } } });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { maxTransportAttempts: 3, skipRules: [] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // veto → no retry
    expect(out.response.status).toBe(503);
  }, 8000);

  it("non-capacity hook veto wins even with an explicit retry rule (429 Retry-After path)", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(429, "rate limited"));
    const ex = new VetoExecutor("prov-x", { baseUrl: "https://x/api", retry: fastRetry });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 3,
        skipRules: [{ provider: "prov-x", match: { status: 429 }, action: "retry" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // hook veto honored → no retry
    expect(out.response.status).toBe(429);
  }, 8000);

  it("explicit retry rule still consults hook and uses its delay (Retry-After respected)", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(429, "rate limited"));
    const hookDelay = 80; // distinct from the 1ms base delay
    const hook = vi.fn(async () => hookDelay);
    class HookExecutor extends BaseExecutor {
      async computeRetryDelay(...args) { return hook(...args); }
    }
    const ex = new HookExecutor("prov-x", { baseUrl: "https://x/api", retry: { 429: { attempts: 5, delayMs: 1 } } });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        maxTransportAttempts: 2,
        skipRules: [{ provider: "prov-x", match: { status: 429 }, action: "retry" }],
      },
    });
    // Hook was consulted for the retry and returned the delay that drove it
    // (retry happened: 2 fetch calls; exact waitMs plumbing covered by existing
    // base-executor-retry hook tests — no wall-clock assertion here).
    expect(hook).toHaveBeenCalled();
    expect(await hook.mock.results[0].value).toBe(hookDelay);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.response.status).toBe(429);
  }, 8000);
});
