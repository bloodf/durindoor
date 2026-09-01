import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

describe("MITM dump logger redaction", () => {
  it("writes request and response metadata without payloads or URL query and fragment content", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-log-"));
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = temp;
    for (const id of ["../../src/mitm/logger.js", "../../src/mitm/paths.js"]) {
      delete require.cache[require.resolve(id)];
    }
    const { dumpRequest, createResponseDumper } = require("../../src/mitm/logger.js");
    const requestBody = "REQUEST-BODY-CANARY";
    const responseChunks = ["RESPONSE-CHUNK-ONE", "RESPONSE-CHUNK-TWO"];
    const request = {
      method: "POST",
      url: "/v1/chat/completions?token=URL-QUERY-CANARY#state=URL-FRAGMENT-CANARY",
      headers: {
        host: "api.example.test",
        cookie: "sid=cookie-secret",
        "x-api-key": "provider-secret",
        "x-goog-api-key": "google-secret",
        "x-amz-security-token": "aws-secret",
        "content-type": "application/json",
      },
    };

    try {
      const requestFile = dumpRequest(request, Buffer.from(requestBody));
      const requestOutput = fs.readFileSync(requestFile, "utf8");
      const parsedRequest = JSON.parse(requestOutput);
      expect(requestFile).not.toMatch(/URL_QUERY_CANARY|URL_FRAGMENT_CANARY/);
      expect(requestOutput).not.toMatch(/REQUEST-BODY-CANARY|URL-QUERY-CANARY|URL-FRAGMENT-CANARY|cookie-secret|provider-secret|google-secret|aws-secret/);
      expect(parsedRequest.url).toBe("/v1/chat/completions");
      expect(parsedRequest.body).toEqual({ redacted: true, present: true, type: "buffer", bytes: Buffer.byteLength(requestBody) });
      expect(parsedRequest.headers).toMatchObject({
        cookie: "[REDACTED]",
        "x-api-key": "[REDACTED]",
        "x-goog-api-key": "[REDACTED]",
        "x-amz-security-token": "[REDACTED]",
        "content-type": "application/json",
      });

      const dumper = createResponseDumper(request, "test");
      dumper.writeHeader(200, { authorization: "Bearer response-header-secret", "content-encoding": "gzip", "content-type": "text/event-stream" });
      for (const chunk of responseChunks) dumper.writeChunk(chunk);
      dumper.end();
      const responseOutput = fs.readFileSync(dumper.file, "utf8");
      const parsedResponse = JSON.parse(responseOutput);
      expect(dumper.file).not.toMatch(/URL_QUERY_CANARY|URL_FRAGMENT_CANARY/);
      expect(responseOutput).not.toMatch(/RESPONSE-CHUNK|URL-QUERY-CANARY|URL-FRAGMENT-CANARY|response-header-secret/);
      expect(parsedResponse).toEqual({
        status: 200,
        url: "/v1/chat/completions",
        headers: {
          authorization: "[REDACTED]",
          "content-encoding": "gzip",
          "content-type": "text/event-stream",
        },
        body: {
          redacted: true,
          present: true,
          type: "stream",
          bytes: responseChunks.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0),
          chunks: 2,
        },
      });
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
