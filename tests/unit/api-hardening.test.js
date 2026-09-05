import { describe, expect, it, vi, beforeEach } from "vitest";
import http from "node:http";

// --- vi.hoisted mocks ------------------------------------------------------
// All `@/lib/localDb` / `@/lib/disabledModelsDb` reads are mocked so the
// focused run never touches the real SQLite layer (which is environment-
// dependent: migrations, credentials, etc.). `getProviderConnections` is a
// controllable deferred so the #6440 coalescing test can hold the first
// in-flight promise open deterministically.

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  updateProviderCredentials: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: db.getProviderConnections,
  getCombos: db.getCombos,
  getCustomModels: db.getCustomModels,
  getModelAliases: db.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: db.getDisabledModels,
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: db.getSettings,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: db.updateProviderCredentials,
}));

import {
  validateMessagesField,
  validateModelField,
  validateChatScalarParams,
  requireJsonContentType,
  validateChatRequestBody,
  jsonNotFoundResponse,
  headOkResponse,
  headNotFoundResponse,
} from "../../open-sse/translator/validate.js";
import { unavailableResponse } from "../../open-sse/utils/error.js";
import { installRequestWrapper } from "../../custom-server.js";

// --- helpers ---------------------------------------------------------------

function jsonRequest(url, { method = "POST", contentType, body } = {}) {
  const headers = {};
  if (contentType !== undefined) headers["content-type"] = contentType;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectError(res, status, type) {
  expect(res.status).toBe(status);
  const json = await res.json();
  expect(json.error).toBeTruthy();
  expect(json.error.type).toBe(type);
  return json.error;
}

/** Default: empty DB → no live connections, no disabled models. */
function stubEmptyDb() {
  db.getProviderConnections.mockResolvedValue([]);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getModelAliases.mockResolvedValue({});
  db.getDisabledModels.mockResolvedValue({});
  db.getSettings.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  stubEmptyDb();
});

// --- #6515 messages guard --------------------------------------------------

describe("validateMessagesField (#6515)", () => {
  it.each([
    [{}, "messages: Expected array, received undefined"],
    [{ messages: "hi" }, "messages: Expected array"],
    [{ messages: [] }, "messages: at least one message is required"],
  ])("rejects %j with 400 invalid_request_error", async (body, msg) => {
    const res = validateMessagesField(body);
    expect(res).toBeInstanceOf(Response);
    const err = await expectError(res, 400, "invalid_request_error");
    expect(err.message).toBe(msg);
  });

  it.each([
    [{ messages: [{ role: "user", content: "hi" }] }],
    [{ input: "hello" }], // Responses API — no messages required
    [{ messages: [{ role: "user", content: "hi" }], input: "x" }],
  ])("passes %j through (null)", (body) => {
    expect(validateMessagesField(body)).toBeNull();
  });
});

// --- #6433 non-string model ------------------------------------------------

describe("validateModelField (#6433)", () => {
  it.each([
    [{ model: 123 }, "number"],
    [{ model: true }, "boolean"],
    [{ model: ["gpt"] }, "array"],
    [{ model: { id: "gpt" } }, "object"],
  ])("rejects non-string model %j with 400", async (body, received) => {
    const res = validateModelField(body);
    expect(res).toBeInstanceOf(Response);
    const err = await expectError(res, 400, "invalid_request_error");
    expect(err.message).toBe(`model: Expected string, received ${received}`);
  });

  it.each([
    [{ model: "gpt-4o" }],
    [{ model: null }], // left for downstream `Missing model` guard
    [{}], // undefined → downstream
  ])("passes %j through (null)", (body) => {
    expect(validateModelField(body)).toBeNull();
  });
});

// --- #6437 scalar params ---------------------------------------------------

describe("validateChatScalarParams (#6437)", () => {
  it.each([
    [{ temperature: "hot" }, "temperature", "must be a number"],
    [{ temperature: NaN }, "temperature", "must be a number"],
    [{ temperature: -1 }, "temperature", "must be between 0 and 2"],
    [{ temperature: 3 }, "temperature", "must be between 0 and 2"],
    [{ top_p: 2 }, "top_p", "must be between 0 and 1"],
    [{ top_p: -0.1 }, "top_p", "must be between 0 and 1"],
    [{ max_tokens: 0 }, "max_tokens", "must be a positive integer"],
    [{ max_tokens: 1.5 }, "max_tokens", "must be a positive integer"],
    [{ n: 0 }, "n", "must be a positive integer"],
  ])("rejects %j with 400 naming the field", async (body, field, msg) => {
    const res = validateChatScalarParams(body);
    expect(res).toBeInstanceOf(Response);
    const err = await expectError(res, 400, "invalid_request_error");
    expect(err.message).toBe(`${field}: ${msg}`);
  });

  it.each([
    [{ temperature: 0.7, top_p: 0.9, max_tokens: 64, n: 1 }],
    [{}],
    [{ temperature: 0, top_p: 1 }], // boundary values OK
  ])("passes %j through (null)", (body) => {
    expect(validateChatScalarParams(body)).toBeNull();
  });
});

// --- #6513 / #6434 content-type 415 ---------------------------------------

describe("requireJsonContentType (#6513 + #6434)", () => {
  it.each([
    ["POST", "text/plain"],
    ["POST", undefined],
    ["POST", "application/x-www-form-urlencoded"],
    ["PUT", "text/plain"],
    ["PATCH", ""],
  ])("rejects %s %s with 415 unsupported_media_type", async (method, ct) => {
    const req = jsonRequest("http://x/v1/chat/completions", { method, contentType: ct });
    const res = requireJsonContentType(req);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(415);
    const json = await res.json();
    expect(json.error.code).toBe("unsupported_media_type");
  });

  it.each([
    ["POST", "application/json"],
    ["POST", "application/json; charset=utf-8"],
    ["POST", "Application/JSON"], // case-insensitive
    ["GET", undefined], // non-mutating methods pass
    ["DELETE", "text/plain"],
    ["HEAD", undefined],
  ])("passes %s %s through (null)", (method, ct) => {
    const req = jsonRequest("http://x/v1/chat/completions", { method, contentType: ct });
    expect(requireJsonContentType(req)).toBeNull();
  });
});

// --- combined chain --------------------------------------------------------

describe("validateChatRequestBody", () => {
  it("short-circuits messages before model before scalars", async () => {
    const res = validateChatRequestBody({ messages: [], model: 5, temperature: 9 });
    const err = await expectError(res, 400, "invalid_request_error");
    expect(err.message.startsWith("messages:")).toBe(true);
  });

  it("returns null for a well-formed chat body", () => {
    expect(
      validateChatRequestBody({
        messages: [{ role: "user", content: "hi" }],
        model: "gpt-4o",
        temperature: 0.5,
        max_tokens: 10,
      }),
    ).toBeNull();
  });
});

// --- #6435 / #6516 JSON 404 ------------------------------------------------

describe("jsonNotFoundResponse (#6435 + #6516)", () => {
  it("returns 404 JSON with not_found type and echoed path", async () => {
    const res = jsonNotFoundResponse(new Request("http://x/v1/unknown/path"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.type).toBe("not_found");
    expect(json.error.code).toBe("unknown_route");
    expect(json.error.path).toBe("/v1/unknown/path");
  });
});

// --- #6517 / #6608 HEAD ----------------------------------------------------

describe("HEAD helpers (#6517 + #6608)", () => {
  it("headOkResponse → 200, null body, JSON content-type + CORS", async () => {
    const res = headOkResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toBe("");
  });

  it("headNotFoundResponse → 404, null body, JSON content-type + CORS", async () => {
    const res = headNotFoundResponse();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toBe("");
  });
});

// --- #6608 global HEAD body suppression via installRequestWrapper ----------

describe("installRequestWrapper HEAD suppression (#6608)", () => {
  function listen(handler) {
    const fakeHttp = {
      createServer: (h) => http.createServer(h),
    };
    installRequestWrapper({ httpModule: fakeHttp, secret: "0".repeat(32), verifyPeerOwner: async () => false });
    return new Promise((resolve) => {
      const server = fakeHttp.createServer(handler);
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
  }

  it("drops the body but preserves status + headers on HEAD", async () => {
    const server = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "x-test": "1" });
      res.end(JSON.stringify({ ok: true, big: "x".repeat(2048) }));
    });
    try {
      const port = server.address().port;
      const headRes = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/x", method: "HEAD" },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(headRes.status).toBe(200);
      expect(headRes.headers["x-test"]).toBe("1");
      expect(headRes.body.length).toBe(0); // body fully suppressed

      // GET still returns the body unchanged.
      const getRes = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/x", method: "GET" },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(getRes.status).toBe(200);
      expect(JSON.parse(getRes.body).ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it("still invokes the res.end callback on HEAD (no hang)", async () => {
    let endCallbackFired = false;
    const server = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("body", () => {
        endCallbackFired = true;
      });
    });
    try {
      const port = server.address().port;
      await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/cb", method: "HEAD" }, (res) => {
          res.on("end", resolve);
          res.resume();
        });
        req.on("error", reject);
        req.end();
      });
      expect(endCallbackFired).toBe(true);
    } finally {
      server.close();
    }
  });
});

// --- #6523 retry_after on 429 ---------------------------------------------

describe("unavailableResponse 429 retry_after (#6523)", () => {
  it("adds type/code/retry_after on 429 and keeps Retry-After header", async () => {
    const when = new Date(Date.now() + 30_000).toISOString();
    const res = unavailableResponse(429, "All accounts rate limited", when, "reset after 30s");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const json = await res.json();
    expect(json.error.type).toBe("rate_limit_error");
    expect(json.error.code).toBe("rate_limit_exceeded");
    expect(typeof json.error.retry_after).toBe("string");
    expect(new Date(json.error.retry_after).toISOString()).toBe(when);
    expect(json.error.message).toContain("reset after 30s");
  });

  it("keeps the legacy minimal envelope for non-429 statuses", async () => {
    const when = new Date(Date.now() + 10_000).toISOString();
    const res = unavailableResponse(503, "All providers down", when, "reset after 10s");
    const json = await res.json();
    expect(json.error.type).toBeUndefined();
    expect(json.error.retry_after).toBeUndefined();
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

// --- #6440 in-flight coalescing -------------------------------------------

describe("buildModelsList coalescing (#6440)", () => {
  it("shares one in-flight promise and catalog for identical filters, then rebuilds after resolution", async () => {
    const mod = await import("../../src/app/api/v1/models/buildModelsList.js");
    let release;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    db.getProviderConnections.mockImplementationOnce(() => {
      markStarted();
      return gate;
    });

    const first = mod.buildModelsList(["llm"]);
    const concurrent = mod.buildModelsList(["llm"]);
    let fresh;
    try {
      await started;
      expect(first).toBe(concurrent);
      expect(db.getProviderConnections).toHaveBeenCalledTimes(1);

      release([]);
      const firstCatalog = await first;
      expect(await concurrent).toBe(firstCatalog);

      fresh = mod.buildModelsList(["llm"]);
      expect(fresh).not.toBe(first);
      await fresh;
      expect(db.getProviderConnections).toHaveBeenCalledTimes(2);
    } finally {
      release([]);
      await Promise.allSettled([first, concurrent, fresh].filter(Boolean));
    }
  });

  it("runs independent aggregations for different kind filters", async () => {
    const mod = await import("../../src/app/api/v1/models/buildModelsList.js");
    let release;
    let markBothStarted;
    let startedCount = 0;
    const bothStarted = new Promise((resolve) => { markBothStarted = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    db.getProviderConnections.mockImplementation(() => {
      startedCount += 1;
      if (startedCount === 2) markBothStarted();
      return gate;
    });

    const llm = mod.buildModelsList(["llm"]);
    const image = mod.buildModelsList(["image"]);
    try {
      await bothStarted;
      expect(llm).not.toBe(image);
      expect(db.getProviderConnections).toHaveBeenCalledTimes(2);
    } finally {
      release([]);
      await Promise.allSettled([llm, image]);
    }
  });
});

// Exercise the actual GET/HEAD/OPTIONS handlers imported from both route modules
// so the focused run proves filters, lookup semantics, projections, status codes,
// CORS, and cheap probes flow through real handler code.

describe("GET /v1/models route handler (mocked DB)", () => {
  it("returns 200 with {object:'list', data} and CORS for llm filter", async () => {
    const { GET } = await import("../../src/app/api/v1/models/route.js");
    db.getProviderConnections.mockResolvedValue([]);
    const res = await GET(new Request("http://x/v1/models"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("GET /v1/models/{kind-or-model} route handler (mocked DB)", () => {
  async function importRoute() {
    return import("../../src/app/api/v1/models/[...model]/route.js");
  }

  function context(model) {
    return { params: Promise.resolve({ model }) };
  }

  it("returns a known kind through the established projected list response", async () => {
    const { GET } = await importRoute();
    const request = new Request("http://x/v1/models/image", {
      headers: { "anthropic-version": "2023-06-01" },
    });
    const res = await GET(request, context(["image"]));

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("has_more", false);
  });

  it.each([
    [["custom", "single-model"]],
    [["custom/single-model"]],
  ])("returns an exact configured provider-prefixed model for decoded segments %j", async (model) => {
    const { GET } = await importRoute();
    db.getCustomModels.mockResolvedValue([
      { providerAlias: "custom", id: "single-model", kind: "llm" },
    ]);

    const res = await GET(
      new Request("http://x/v1/models/custom%2Fsingle-model"),
      context(model),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({
      id: "custom/single-model",
      object: "model",
      owned_by: "custom",
    });
  });

  it("returns OpenAI model_not_found for a missing provider-prefixed model", async () => {
    const { GET } = await importRoute();
    const res = await GET(
      new Request("http://x/v1/models/custom/missing"),
      context(["custom", "missing"]),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(body.error).toMatchObject({
      type: "invalid_request_error",
      code: "model_not_found",
    });
  });

  it("preserves legacy Unknown model kind for an unknown one-segment path", async () => {
    const { GET } = await importRoute();
    const res = await GET(
      new Request("http://x/v1/models/nope"),
      context(["nope"]),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBeUndefined();
    expect(body.error.message).toContain("Unknown model kind: nope");
    expect(db.getProviderConnections).not.toHaveBeenCalled();
  });

  it("advertises GET, HEAD, OPTIONS with CORS", async () => {
    const { OPTIONS } = await importRoute();
    const res = await OPTIONS();

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("*");
  });
});

describe("HEAD /v1/models route handler (mocked DB)", () => {
  it("returns 200 null body with CORS without hitting the DB", async () => {
    const { HEAD } = await import("../../src/app/api/v1/models/route.js");
    const res = await HEAD();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toBe("");
    expect(db.getProviderConnections).not.toHaveBeenCalled();
  });

  it.each([
    [["nope"], 404],
    [["tts"], 200],
    [["custom", "single-model"], 200],
    [["custom/single-model"], 200],
  ])("returns cheap status for %j without building the catalog", async (model, status) => {
    const { HEAD } = await import("../../src/app/api/v1/models/[...model]/route.js");
    const res = await HEAD(
      new Request(`http://x/v1/models/${model.join("/")}`),
      { params: Promise.resolve({ model }) },
    );

    expect(res.status).toBe(status);
    expect(await res.text()).toBe("");
    expect(db.getProviderConnections).not.toHaveBeenCalled();
  });
});
