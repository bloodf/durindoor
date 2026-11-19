import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isOperatorRequest: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: mocks.isOperatorRequest }));

const route = await import("../../src/app/api/providers/lan-discovery/route.js");
const { MAX_IN_FLIGHT, scanLanDiscovery } = await import("../../src/lib/lanDiscovery/index.js");

function request(body) {
  return { json: vi.fn().mockResolvedValue(body) };
}

/** @returns {Promise<{ server: import("node:http").Server, port: number, close: () => Promise<void> }>} */
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

describe("POST /api/providers/lan-discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOperatorRequest.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({ lanDiscoveryEnabled: true });
  });

  it("returns 403 Forbidden for non-operator callers", async () => {
    mocks.isOperatorRequest.mockResolvedValue(false);
    const response = await route.POST(request({ hosts: ["127.0.0.1"], ports: [9] }));
    expect(response).toEqual({ status: 403, body: { error: "Forbidden" } });
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("returns 403 lan_discovery_disabled while the setting is off", async () => {
    mocks.getSettings.mockResolvedValue({ lanDiscoveryEnabled: false });
    const response = await route.POST(request({ hosts: ["127.0.0.1"], ports: [9] }));
    expect(response).toEqual({ status: 403, body: { error: "lan_discovery_disabled" } });
  });

  it("returns 400 when neither hosts nor cidr is provided", async () => {
    const response = await route.POST(request({ ports: [11434] }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/hosts or cidr/);
  });

  it("returns 400 when both hosts and cidr are provided", async () => {
    const response = await route.POST(request({ hosts: ["127.0.0.1"], cidr: "10.0.0.1/32" }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not both/);
  });

  it("returns 400 when more than 8 ports are requested", async () => {
    const response = await route.POST(request({
      hosts: ["127.0.0.1"],
      ports: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/ports/);
  });

  it("returns 400 when a CIDR expands past 256 addresses", async () => {
    const response = await route.POST(request({ cidr: "10.0.0.0/23" }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/256/);
  });

  it("discovers Ollama and OpenAI-compatible mock servers on 127.0.0.1", async () => {
    const ollama = await listen((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "llama3:latest" }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const openai = await listen((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-local" }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const response = await route.POST(request({
        hosts: ["127.0.0.1"],
        ports: [ollama.port, openai.port],
      }));

      expect(response.status).toBe(200);
      expect(response.body.candidates).toEqual(expect.arrayContaining([
        {
          baseUrl: `http://127.0.0.1:${ollama.port}`,
          host: "127.0.0.1",
          port: ollama.port,
          kind: "ollama",
          models: ["llama3:latest"],
        },
        {
          baseUrl: `http://127.0.0.1:${openai.port}/v1`,
          host: "127.0.0.1",
          port: openai.port,
          kind: "openai-compatible",
          models: ["gpt-local"],
        },
      ]));
      expect(response.body.candidates).toHaveLength(2);
    } finally {
      await ollama.close();
      await openai.close();
    }
  });

  it("keeps cloud-metadata hosts blocked and returns no candidates", async () => {
    const response = await route.POST(request({
      hosts: ["169.254.169.254", "metadata.google.internal"],
      ports: [80],
    }));
    expect(response.status).toBe(200);
    expect(response.body.candidates).toEqual([]);
  });
});

describe("scanLanDiscovery concurrency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps in-flight probes at 32", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = [];

    const fetchImpl = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      started.push(1);
      if (started.length === MAX_IN_FLIGHT) {
        // First wave filled the limiter; release everyone after observing the cap.
        queueMicrotask(() => release());
      }
      await gate;
      inFlight--;
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    // 40 hosts × 1 port × 2 kinds = 80 probes; limiter must stay ≤ 32.
    const hosts = Array.from({ length: 40 }, (_, i) => `10.0.0.${i + 1}`);
    const resultPromise = scanLanDiscovery(
      { hosts, ports: [11434] },
      { fetchImpl, timeoutMs: 5000 }
    );

    await gate;
    expect(maxInFlight).toBe(MAX_IN_FLIGHT);
    expect(maxInFlight).toBeLessThanOrEqual(MAX_IN_FLIGHT);

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(80);
    expect(maxInFlight).toBe(MAX_IN_FLIGHT);
  });
});
