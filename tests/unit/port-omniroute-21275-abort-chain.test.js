import { readFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/sse/services/admission.js", () => ({
  admit: async () => ({ auth: { stored: true } }),
}));

import { decodeAnthropicRequest } from "../../src/sse/utils/inboundGzip.js";
import { readBoundedRequest } from "../../src/sse/utils/readBoundedRequest.js";
import { keepAbortChain } from "../../src/shared/utils/abortChain.js";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

async function collect() {
  for (let round = 0; round < 8; round++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function inboundRequest(client, headers = {}, body = "{}") {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    signal: client.signal,
  });
}

describe("OmniRoute #21275: a rebuilt request keeps the client abort after GC", () => {
  it("keeps the abort on the signal of a decoded gzip request", async () => {
    const client = new AbortController();
    // The server holds the inbound request; downstream code holds only the signal.
    const inbound = inboundRequest(client, { "content-encoding": "gzip" }, gzipSync("{}"));
    const signal = await decodeAnthropicRequest(inbound).then(({ request }) => request.signal);
    await collect();

    client.abort();

    expect(inbound.signal.aborted).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it("keeps the abort when the source request is only reachable through the new signal", async () => {
    const client = new AbortController();
    const signal = (() => {
      const source = inboundRequest(client);
      return keepAbortChain(new Request(source.url, { signal: source.signal }), source).signal;
    })();
    await collect();

    client.abort();

    expect(signal.aborted).toBe(true);
  });

  it("leaves the rebuilt request cloneable with a following signal", () => {
    const client = new AbortController();
    const source = inboundRequest(client);
    const rebuilt = keepAbortChain(new Request(source, { signal: source.signal }), source);
    const copy = rebuilt.clone();

    client.abort();

    expect(rebuilt.signal.aborted).toBe(true);
    expect(copy.signal.aborted).toBe(true);
  });

  it("retains the source abort chain through the shared bounded reader", async () => {
    const client = new AbortController();
    const signal = await readBoundedRequest(inboundRequest(client), 100).then((request) => request.signal);
    await collect();
    client.abort();
    expect(signal.aborted).toBe(true);
  });

  it("routes image edit uploads through the shared bounded reader", () => {
    const source = readFileSync(new URL("../../src/sse/handlers/imageEdit.js", import.meta.url), "utf8");
    expect(source).toMatch(/import \{ readBoundedRequest \} from /);
    expect(source).toMatch(/await readBoundedRequest\(request,/);
  });

  it("ties the Gemini v1beta derived request to the inbound request", () => {
    const source = readFileSync(new URL("../../src/app/api/v1beta/models/[...path]/route.js", import.meta.url), "utf8");
    expect(source).toMatch(/keepAbortChain\(new Request\(request.url,[\s\S]*?signal: request.signal[\s\S]*?\), request\)/);
  });

  // These rebuilds sit in private helpers, so the call sites are pinned by source.
  it.each([
    "src/sse/handlers/stt.js",
    "src/sse/utils/readBoundedRequest.js",
    "src/sse/handlers/completions.js",
    "src/app/api/v1beta/interactions/route.js",
    "src/sse/utils/inboundGzip.js",
  ])("ties every rebuild that forwards the client signal in %s", (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const forwarded = (source.match(/(?:keepAbortChain\()?new Request\([^;]*;/g) || [])
      .filter((statement) => statement.includes("signal: request.signal"));

    expect(forwarded.length).toBeGreaterThan(0);
    expect(forwarded.filter((statement) => !statement.startsWith("keepAbortChain("))).toEqual([]);
  });
});
