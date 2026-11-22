// decolua/9router#3630 (OWASP hardening, MITM Root CA item): certificate serial
// numbers come from a CSPRNG, not a fixed "01" / Math.random() 6-digit value.
import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const forge = require("node-forge");

function loadRootCAWithDataDir(dataDir) {
  const rootCAPath = require.resolve("../../src/mitm/cert/rootCA.js");
  const pathsPath = require.resolve("../../src/mitm/paths.js");
  delete require.cache[rootCAPath];
  delete require.cache[pathsPath];
  const oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    return require("../../src/mitm/cert/rootCA.js");
  } finally {
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
  }
}

describe("MITM certificate serial numbers (#3630)", () => {
  it("gives the Root CA and leaf certificates 128-bit positive random serials", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-serial-"));
    try {
      const mod = loadRootCAWithDataDir(dataDir);
      mod.generateRootCA();
      const rootCA = mod.loadRootCA();
      const rootSerial = rootCA.cert.serialNumber;
      expect(rootSerial).toMatch(/^[0-9a-f]{32}$/);
      expect(rootSerial).not.toBe("01");
      expect(parseInt(rootSerial.slice(0, 2), 16)).toBeLessThan(0x80);

      const a = forge.pki.certificateFromPem(mod.generateLeafCert("a.example.test", rootCA).cert);
      const b = forge.pki.certificateFromPem(mod.generateLeafCert("a.example.test", rootCA).cert);
      for (const leaf of [a, b]) {
        expect(leaf.serialNumber).toMatch(/^[0-9a-f]{32}$/);
        expect(parseInt(leaf.serialNumber.slice(0, 2), 16)).toBeLessThan(0x80);
      }
      expect(a.serialNumber).not.toBe(b.serialNumber);
      expect(a.serialNumber).not.toBe(rootSerial);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60000);
});
