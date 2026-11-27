// Private Bedrock model discovery (#2034). The AWS SDK serializer, signer and deserializer
// run for real; only the network transport (proxyAwareFetch) and the profile credential
// resolver (fromIni) are mocked. No request leaves the process, no real AWS profile, SSO
// cache or instance metadata is read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ handler: null, calls: [] }));
const profiles = vi.hoisted(() => ({ fromIni: null }));

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(async (url, init, proxyOptions) => {
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { url: new URL(url), init, headers, proxyOptions };
    network.calls.push(call);
    if (!network.handler) throw new Error("unexpected network call");
    return network.handler(call);
  }),
}));

vi.mock("@aws-sdk/credential-provider-ini", () => ({
  fromIni: vi.fn((init) => {
    if (!profiles.fromIni) throw new Error("unexpected profile resolution");
    return profiles.fromIni(init);
  }),
}));

const { discoverBedrockModels, BedrockDiscoveryError } = await import(
  "../../open-sse/services/providerParity/native-bedrock-discovery/index.js"
);
const { normalizeBedrockDiscoveredModels } = await import(
  "../../open-sse/services/providerParity/native-bedrock-discovery/normalize.js"
);
const { fromIni } = await import("@aws-sdk/credential-provider-ini");

// Synthetic accounts. None of these are real keys.
const ACCOUNT_A = {
  apiKey: "synthetic-secret-account-a-0000000000000000",
  providerSpecificData: { accessKeyId: "AKIASYNTHETICAAAA001", region: "us-west-2" },
};
const ACCOUNT_B = {
  apiKey: "synthetic-secret-account-b-1111111111111111",
  sessionToken: "synthetic-session-token-account-b",
  providerSpecificData: { accessKeyId: "ASIASYNTHETICBBBB002", region: "eu-central-1" },
};
const BEARER = { apiKey: "synthetic-bedrock-api-key-cccc", providerSpecificData: { region: "ap-southeast-2" } };

const FOUNDATION = {
  modelSummaries: [
    {
      modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      modelName: "Claude Sonnet 4.5",
      providerName: "Anthropic",
      inputModalities: ["TEXT", "IMAGE"],
      outputModalities: ["TEXT"],
      responseStreamingSupported: true,
    },
    {
      modelId: "amazon.nova-micro-v1:0",
      modelName: "Nova Micro",
      providerName: "Amazon",
      inputModalities: ["TEXT"],
      outputModalities: ["TEXT"],
      responseStreamingSupported: false,
    },
  ],
};
const PROFILE_PAGE_1 = {
  inferenceProfileSummaries: [
    {
      inferenceProfileId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      inferenceProfileName: "US Claude Sonnet 4.5",
      inferenceProfileArn: "arn:aws:bedrock:us-west-2:000000000000:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      status: "ACTIVE",
      type: "SYSTEM_DEFINED",
      models: [
        { modelArn: "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0" },
        { modelArn: "arn:aws:bedrock:us-east-1::foundation-model/meta.llama3-3-70b-instruct-v1:0" },
      ],
    },
  ],
  nextToken: "page-2",
};
const PROFILE_PAGE_2 = {
  inferenceProfileSummaries: [
    { inferenceProfileId: "us.amazon.nova-micro-v1:0", inferenceProfileName: "US Nova Micro", status: "ACTIVE", type: "SYSTEM_DEFINED", models: [] },
  ],
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-amzn-requestid": "req-1", ...extraHeaders },
  });
}

function awsError(status, type, message) {
  return json({ message, __type: type }, status, { "x-amzn-errortype": `${type}:http://internal.amazon.com/` });
}

/** Answer like the Bedrock control plane: foundation list, then two profile pages. */
function bedrockLike(overrides = {}) {
  return (call) => {
    const path = call.url.pathname;
    if (path === "/foundation-models") return overrides.foundation?.(call) ?? json(FOUNDATION);
    if (path === "/inference-profiles") {
      if (overrides.profiles) return overrides.profiles(call);
      return json(call.url.searchParams.get("nextToken") === "page-2" ? PROFILE_PAGE_2 : PROFILE_PAGE_1);
    }
    throw new Error(`unexpected path ${path}`);
  };
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected discovery to fail");
}

function allHeaderText() {
  return network.calls.map((call) => JSON.stringify(call.headers)).join("\n");
}

beforeEach(() => {
  network.handler = null;
  network.calls = [];
  profiles.fromIni = null;
  vi.mocked(fromIni).mockClear();
  // Ambient AWS configuration a server might carry. Discovery must ignore all of it.
  vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
  vi.stubEnv("AWS_CONFIG_FILE", "/nonexistent/durindoor-test/aws-config");
  vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", "/nonexistent/durindoor-test/aws-credentials");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAAMBIENTENVIRON99");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "ambient-environment-secret");
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "ambient-environment-bearer");
  vi.stubEnv("AWS_PROFILE", "ambient-profile");
  vi.stubEnv("AWS_REGION", "sa-east-1");
  vi.stubEnv("AWS_ENDPOINT_URL", "https://ambient-endpoint.example.test");
  vi.stubEnv("AWS_ENDPOINT_URL_BEDROCK", "https://ambient-bedrock.example.test");
  vi.stubEnv("AWS_USE_FIPS_ENDPOINT", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Bedrock discovery: static IAM keys", () => {
  it("signs both list calls with SigV4 for the selected account and region and normalizes the result", async () => {
    network.handler = bedrockLike();
    const result = await discoverBedrockModels({ credentials: ACCOUNT_A });

    expect(network.calls.map((call) => `${call.init.method} ${call.url.origin}${call.url.pathname}`)).toEqual([
      "GET https://bedrock.us-west-2.amazonaws.com/foundation-models",
      "GET https://bedrock.us-west-2.amazonaws.com/inference-profiles",
      "GET https://bedrock.us-west-2.amazonaws.com/inference-profiles",
    ]);
    expect(network.calls[0].url.searchParams.get("byOutputModality")).toBe("TEXT");
    // SDK serialization: ListInferenceProfiles `typeEquals` travels as the `type` query key.
    expect(network.calls[1].url.searchParams.get("type")).toBe("SYSTEM_DEFINED");
    expect(network.calls[1].url.searchParams.get("maxResults")).toBe("100");
    expect(network.calls[2].url.searchParams.get("nextToken")).toBe("page-2");

    for (const call of network.calls) {
      expect(call.init.redirect).toBe("manual");
      expect(call.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIASYNTHETICAAAA001\/\d{8}\/us-west-2\/bedrock\/aws4_request, SignedHeaders=[a-z0-9;-]*host[a-z0-9;-]*, Signature=[0-9a-f]{64}$/
      );
      expect(call.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
      expect(call.headers["x-amz-security-token"]).toBeUndefined();
      expect(call.headers.host).toBeUndefined();
    }
    // The secret access key is a signing input only; it never travels, least of all as a bearer.
    expect(allHeaderText()).not.toContain(ACCOUNT_A.apiKey);
    expect(allHeaderText()).not.toContain("Bearer");
    expect(allHeaderText()).not.toContain("ambient");

    expect(result.region).toBe("us-west-2");
    expect(result.mode).toBe("static");
    expect(result.warnings).toEqual([]);
    expect(result.models.map((model) => [model.id, model.source])).toEqual([
      ["amazon.nova-micro-v1:0", "foundation"],
      ["anthropic.claude-sonnet-4-5-20250929-v1:0", "foundation"],
      ["meta.llama3-3-70b-instruct-v1:0", "foundation"],
      ["us.amazon.nova-micro-v1:0", "inference_profile"],
      ["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "inference_profile"],
    ]);
  });

  it("sends the encrypted top-level session token for temporary keys and never a plaintext one", async () => {
    network.handler = bedrockLike();
    const credentials = {
      ...ACCOUNT_B,
      providerSpecificData: { ...ACCOUNT_B.providerSpecificData, sessionToken: "plaintext-psd-session-token" },
    };
    await discoverBedrockModels({ credentials });
    for (const call of network.calls) {
      expect(call.url.origin).toBe("https://bedrock.eu-central-1.amazonaws.com");
      expect(call.headers["x-amz-security-token"]).toBe(ACCOUNT_B.sessionToken);
      expect(call.headers.authorization).toMatch(/Credential=ASIASYNTHETICBBBB002\/\d{8}\/eu-central-1\/bedrock\/aws4_request/);
    }
    expect(allHeaderText()).not.toContain("plaintext-psd-session-token");
    expect(allHeaderText()).not.toContain(ACCOUNT_B.apiKey);
  });

  it("refuses a temporary key whose token sits only in plaintext provider data, before any request", async () => {
    network.handler = bedrockLike();
    const error = await failure(discoverBedrockModels({
      credentials: {
        apiKey: ACCOUNT_B.apiKey,
        providerSpecificData: { ...ACCOUNT_B.providerSpecificData, sessionToken: "plaintext-psd-session-token" },
      },
    }));
    expect(error).toBeInstanceOf(BedrockDiscoveryError);
    expect(error).toMatchObject({ kind: "auth", status: 401, code: "InvalidCredentials" });
    expect(error.message).toMatch(/temporary AWS access key/);
    expect(error.message).not.toContain(ACCOUNT_B.apiKey);
    expect(network.calls).toHaveLength(0);
  });

  it("keeps two accounts in two regions apart when discovered concurrently", async () => {
    network.handler = bedrockLike();
    await Promise.all([
      discoverBedrockModels({ credentials: ACCOUNT_A }),
      discoverBedrockModels({ credentials: ACCOUNT_B }),
    ]);
    const byOrigin = (origin) => network.calls.filter((call) => call.url.origin === origin);
    const a = byOrigin("https://bedrock.us-west-2.amazonaws.com");
    const b = byOrigin("https://bedrock.eu-central-1.amazonaws.com");
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    for (const call of a) {
      expect(call.headers.authorization).toContain("AKIASYNTHETICAAAA001");
      expect(call.headers["x-amz-security-token"]).toBeUndefined();
    }
    for (const call of b) {
      expect(call.headers.authorization).toContain("ASIASYNTHETICBBBB002");
      expect(call.headers["x-amz-security-token"]).toBe(ACCOUNT_B.sessionToken);
    }
  });

  it("produces different signatures for different secrets on the same request", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-27T12:00:00Z") });
    network.handler = bedrockLike();
    await discoverBedrockModels({ credentials: ACCOUNT_A });
    const first = network.calls[0].headers.authorization;
    network.calls = [];
    await discoverBedrockModels({ credentials: { ...ACCOUNT_A, apiKey: "synthetic-other-secret" } });
    const second = network.calls[0].headers.authorization;
    expect(first.split("Signature=")[0]).toBe(second.split("Signature=")[0]);
    expect(first.split("Signature=")[1]).not.toBe(second.split("Signature=")[1]);
  });
});

describe("Bedrock discovery: Bedrock API key", () => {
  it("sends the API key only as a bearer token, never signs with it, and ignores the ambient bearer", async () => {
    network.handler = bedrockLike();
    const result = await discoverBedrockModels({ credentials: BEARER });
    expect(result.mode).toBe("apiKey");
    for (const call of network.calls) {
      expect(call.url.origin).toBe("https://bedrock.ap-southeast-2.amazonaws.com");
      expect(call.headers.authorization).toBe(`Bearer ${BEARER.apiKey}`);
      expect(call.headers["x-amz-security-token"]).toBeUndefined();
    }
    expect(allHeaderText()).not.toContain("AWS4-HMAC-SHA256");
    expect(allHeaderText()).not.toContain("ambient");
  });

  it("refuses a session token without an access key id instead of reading the API key as an AWS secret", async () => {
    network.handler = bedrockLike();
    const error = await failure(discoverBedrockModels({ credentials: { ...BEARER, sessionToken: "synthetic-session" } }));
    expect(error).toMatchObject({ kind: "config", status: 400, code: "InvalidCredentials" });
    expect(network.calls).toHaveLength(0);
  });

  it("refuses a connection with no credential at all, before any request", async () => {
    network.handler = bedrockLike();
    const error = await failure(discoverBedrockModels({ credentials: { providerSpecificData: { region: "us-east-1" } } }));
    expect(error).toMatchObject({ kind: "auth", status: 401 });
    expect(error.message).toMatch(/Missing Bedrock credentials/);
    expect(network.calls).toHaveLength(0);
  });
});

describe("Bedrock discovery: AWS profile", () => {
  it("signs with the credentials the mocked profile resolver returns", async () => {
    profiles.fromIni = () => async () => ({
      accessKeyId: "ASIASYNTHETICPROF003",
      secretAccessKey: "synthetic-profile-secret",
      sessionToken: "synthetic-profile-session",
    });
    network.handler = bedrockLike();
    const result = await discoverBedrockModels({
      credentials: { providerSpecificData: { profile: "synthetic-sso", region: "us-east-2" } },
    });
    expect(result.mode).toBe("profile");
    expect(fromIni).toHaveBeenCalledWith({ profile: "synthetic-sso" });
    for (const call of network.calls) {
      expect(call.url.origin).toBe("https://bedrock.us-east-2.amazonaws.com");
      expect(call.headers.authorization).toMatch(/Credential=ASIASYNTHETICPROF003\/\d{8}\/us-east-2\/bedrock\/aws4_request/);
      expect(call.headers["x-amz-security-token"]).toBe("synthetic-profile-session");
    }
    expect(allHeaderText()).not.toContain("synthetic-profile-secret");
    expect(allHeaderText()).not.toContain("Bearer");
  });

  it("reports an unresolvable profile as an auth failure without the provider's message", async () => {
    profiles.fromIni = () => async () => {
      throw Object.assign(new Error("Profile synthetic-sso not found in /home/someone/.aws/config"), {
        name: "CredentialsProviderError",
      });
    };
    network.handler = bedrockLike();
    const error = await failure(discoverBedrockModels({ credentials: { providerSpecificData: { profile: "synthetic-sso" } } }));
    expect(error).toMatchObject({ kind: "auth", status: 401, code: "CredentialsProviderError" });
    expect(error.message).not.toContain(".aws");
    expect(network.calls).toHaveLength(0);
  });

  it("refuses an invalid profile name before the resolver sees it", async () => {
    const error = await failure(discoverBedrockModels({ credentials: { providerSpecificData: { profile: "../../etc/passwd" } } }));
    expect(error).toMatchObject({ kind: "auth", status: 401, code: "InvalidCredentials" });
    expect(fromIni).not.toHaveBeenCalled();
  });

  it("bounds profile resolution by the discovery deadline", async () => {
    profiles.fromIni = () => () => new Promise(() => {});
    network.handler = bedrockLike();
    const error = await failure(discoverBedrockModels({
      credentials: { providerSpecificData: { profile: "synthetic-sso" } },
      timeoutMs: 50,
    }));
    expect(error).toMatchObject({ kind: "timeout", status: 504 });
    expect(network.calls).toHaveLength(0);
  });
});

describe("Bedrock discovery: origin, proxy and redirects", () => {
  it("routes through the connection's proxy settings with explicit options merged over them", async () => {
    network.handler = bedrockLike();
    await discoverBedrockModels({
      credentials: {
        ...ACCOUNT_A,
        providerSpecificData: {
          ...ACCOUNT_A.providerSpecificData,
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy-a.internal.test:3128",
        },
      },
      proxyOptions: { connectionNoProxy: "localhost" },
    });
    for (const call of network.calls) {
      expect(call.proxyOptions).toMatchObject({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy-a.internal.test:3128",
      });
    }
  });

  it("derives the origin only from a valid region, never from an arbitrary base URL", async () => {
    network.handler = bedrockLike();
    await discoverBedrockModels({
      credentials: { apiKey: BEARER.apiKey, providerSpecificData: { baseUrl: "https://attacker.example.test/v1" } },
    });
    expect(new Set(network.calls.map((call) => call.url.origin))).toEqual(new Set(["https://bedrock.us-east-1.amazonaws.com"]));
    network.calls = [];
    await discoverBedrockModels({
      credentials: { apiKey: BEARER.apiKey, providerSpecificData: { baseUrl: "https://bedrock-runtime.ap-south-1.amazonaws.com" } },
    });
    expect(new Set(network.calls.map((call) => call.url.origin))).toEqual(new Set(["https://bedrock.ap-south-1.amazonaws.com"]));
  });

  it("refuses a redirect without following it or resending the credential", async () => {
    network.handler = () =>
      new Response(null, { status: 307, headers: { location: "https://attacker.example.test/collect" } });
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toMatchObject({ kind: "refused", code: "RedirectRefused" });
    expect(network.calls).toHaveLength(1);
  });

  it("refuses an answer that came from another origin", async () => {
    network.handler = () => {
      const response = json(FOUNDATION);
      Object.defineProperty(response, "url", { value: "https://attacker.example.test/foundation-models" });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    };
    const error = await failure(discoverBedrockModels({ credentials: BEARER }));
    expect(error).toMatchObject({ kind: "refused", code: "ForeignOrigin" });
  });
});

describe("Bedrock discovery: refused answers are redacted", () => {
  const leak = "upstream says secret synthetic-secret-account-a-0000000000000000 at arn:aws:iam::000000000000:user/x";

  it.each([
    [403, "AccessDeniedException", { kind: "auth", status: 403, code: "AccessDeniedException" }],
    [401, "UnrecognizedClientException", { kind: "auth", status: 401, code: "UnrecognizedClientException" }],
    [429, "ThrottlingException", { kind: "quota", status: 429, code: "ThrottlingException" }],
    [400, "ValidationException", { kind: "config", status: 400, code: "ValidationException" }],
    [500, "InternalServerException", { kind: "upstream", status: 502, code: "InternalServerException" }],
  ])("maps %i %s without quoting the upstream body", async (status, type, expected) => {
    network.handler = () => awsError(status, type, leak);
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toBeInstanceOf(BedrockDiscoveryError);
    expect(error).toMatchObject(expected);
    expect(error.message).not.toContain("synthetic-secret");
    expect(error.message).not.toContain("arn:aws");
    expect(JSON.stringify(error)).not.toContain("synthetic-secret");
    expect(error.cause).toBeUndefined();
    expect(network.calls).toHaveLength(1);
  });

  it("reports a transport failure without its detail", async () => {
    network.handler = () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" });
    };
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toMatchObject({ kind: "unavailable", status: 502 });
    expect(error.message).not.toContain("10.0.0.1");
  });
});

describe("Bedrock discovery: response validation and pagination", () => {
  it("fails on a foundation answer that is not a model list", async () => {
    network.handler = bedrockLike({ foundation: () => json({ models: [] }) });
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toMatchObject({ kind: "invalid_response", status: 502 });
  });

  it("fails on a malformed foundation row", async () => {
    network.handler = bedrockLike({ foundation: () => json({ modelSummaries: [{ modelId: "bad id with spaces" }] }) });
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toMatchObject({ kind: "invalid_response" });
  });

  it("fails on an oversized body", async () => {
    const huge = { modelSummaries: [{ modelId: "amazon.nova-micro-v1:0", modelName: "x".repeat(3 * 1024 * 1024) }] };
    network.handler = bedrockLike({ foundation: () => json(huge) });
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toMatchObject({ kind: "invalid_response" });
  });

  it("keeps foundation models and warns when inference profiles fail upstream (source behavior)", async () => {
    network.handler = bedrockLike({ profiles: () => awsError(500, "InternalServerException", "boom") });
    const result = await discoverBedrockModels({ credentials: ACCOUNT_A });
    expect(result.models.map((model) => model.id)).toEqual(["amazon.nova-micro-v1:0", "anthropic.claude-sonnet-4-5-20250929-v1:0"]);
    expect(result.warnings).toEqual(["Bedrock inference profiles unavailable (InternalServerException)"]);
  });

  it("fails when inference profiles are refused for auth (source behavior)", async () => {
    network.handler = bedrockLike({ profiles: () => awsError(403, "AccessDeniedException", "no") });
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A }));
    expect(error).toMatchObject({ kind: "auth", status: 403 });
  });

  it("stops on a repeated page token", async () => {
    network.handler = bedrockLike({ profiles: () => json({ ...PROFILE_PAGE_2, nextToken: "loop" }) });
    const result = await discoverBedrockModels({ credentials: ACCOUNT_A });
    expect(result.warnings).toEqual(["Bedrock inference profiles unavailable (InvalidResponse)"]);
    expect(network.calls).toHaveLength(3);
  });

  it("stops after the page limit", async () => {
    let page = 0;
    network.handler = bedrockLike({ profiles: () => json({ ...PROFILE_PAGE_2, nextToken: `token-${++page}` }) });
    const result = await discoverBedrockModels({ credentials: ACCOUNT_A });
    expect(result.warnings).toEqual(["Bedrock inference profiles unavailable (InvalidResponse)"]);
    expect(network.calls).toHaveLength(1 + 10);
  });
});

describe("Bedrock discovery: abort and deadline", () => {
  it("sends nothing when the caller already aborted", async () => {
    network.handler = bedrockLike();
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A, signal: AbortSignal.abort() }));
    expect(error).toMatchObject({ kind: "aborted" });
    expect(network.calls).toHaveLength(0);
  });

  it("passes the caller's abort to the in-flight request", async () => {
    const controller = new AbortController();
    let seenSignal = null;
    network.handler = (call) => {
      seenSignal = call.init.signal;
      return new Promise((_, reject) => call.init.signal.addEventListener("abort", () => reject(call.init.signal.reason)));
    };
    const pending = discoverBedrockModels({ credentials: ACCOUNT_A, signal: controller.signal });
    await vi.waitFor(() => expect(network.calls).toHaveLength(1));
    controller.abort();
    const error = await failure(pending);
    expect(error).toMatchObject({ kind: "aborted", status: 499 });
    expect(seenSignal.aborted).toBe(true);
  });

  it("ends on caller abort even if the transport ignores its signal", async () => {
    const controller = new AbortController();
    network.handler = () => new Promise(() => {});
    const pending = discoverBedrockModels({ credentials: BEARER, signal: controller.signal });
    await vi.waitFor(() => expect(network.calls).toHaveLength(1));
    controller.abort();
    expect(await failure(pending)).toMatchObject({ kind: "aborted" });
  });

  it("times out a request that never answers", async () => {
    network.handler = () => new Promise(() => {});
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A, timeoutMs: 50 }));
    expect(error).toMatchObject({ kind: "timeout", status: 504 });
  });

  it("times out a body that never ends", async () => {
    network.handler = () =>
      new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/json" } });
    const error = await failure(discoverBedrockModels({ credentials: ACCOUNT_A, timeoutMs: 50 }));
    expect(error).toMatchObject({ kind: "timeout" });
  });
});

describe("Bedrock discovery normalization", () => {
  it("reports only capabilities AWS declared and no limits or prices", () => {
    const models = normalizeBedrockDiscoveredModels(FOUNDATION.modelSummaries, PROFILE_PAGE_1.inferenceProfileSummaries);
    const byId = Object.fromEntries(models.map((model) => [model.id, model]));
    expect(byId["anthropic.claude-sonnet-4-5-20250929-v1:0"]).toEqual({
      id: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      name: "Claude Sonnet 4.5",
      source: "foundation",
      provider: "Anthropic",
      supportsStreaming: true,
      supportsVision: true,
    });
    expect(byId["us.anthropic.claude-sonnet-4-5-20250929-v1:0"]).toMatchObject({ supportsStreaming: null, supportsVision: null });
    expect(byId["meta.llama3-3-70b-instruct-v1:0"]).toMatchObject({ source: "foundation", supportsStreaming: null });
    for (const model of models) {
      expect(Object.keys(model).sort()).toEqual(["id", "name", "provider", "source", "supportsStreaming", "supportsVision"]);
    }
  });
});
