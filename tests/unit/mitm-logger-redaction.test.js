import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

describe("MITM dump logger redaction", () => {
  it("writes shared-sanitizer output instead of intercepted credentials", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-log-"));
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = temp;
    for (const id of ["../../src/mitm/logger.js", "../../src/mitm/paths.js"]) {
      delete require.cache[require.resolve(id)];
    }
    const { dumpRequest } = require("../../src/mitm/logger.js");

    try {
      const file = dumpRequest({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          host: "api.example.test",
          cookie: "sid=cookie-secret",
          "x-api-key": "provider-secret",
          "x-goog-api-key": "google-secret",
          "x-amz-security-token": "aws-secret",
          "content-type": "application/json",
        },
      }, Buffer.from("{}"));
      const output = fs.readFileSync(file, "utf8");
      expect(output).not.toMatch(/cookie-secret|provider-secret|google-secret|aws-secret/);
      expect(JSON.parse(output).headers).toMatchObject({
        cookie: "[REDACTED]",
        "x-api-key": "[REDACTED]",
        "x-goog-api-key": "[REDACTED]",
        "x-amz-security-token": "[REDACTED]",
        "content-type": "application/json",
      });
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
