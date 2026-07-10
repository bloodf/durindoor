import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import forge from "node-forge";

const require = createRequire(import.meta.url);
const {
  assertDurinDoorRootCertificate,
  certificatesMatch,
  quoteSh,
  readNssCertificate,
  replaceNssCertificate,
} = require("../../src/mitm/cert/install.js");

function findCertutil() {
  try {
    return childProcess.execFileSync("/bin/sh", ["-c", "command -v certutil"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}` },
    }).trim();
  } catch {
    return null;
  }
}

function createCertificate(commonName = "9Router MITM Root CA") {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: "commonName", value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: "basicConstraints", cA: true, critical: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe("MITM certificate command argument quoting", () => {
  it.each([
    ["/tmp/cert with spaces.crt", "'/tmp/cert with spaces.crt'"],
    ["/tmp/$(touch marker).crt", "'/tmp/$(touch marker).crt'"],
    ["/tmp/`touch marker`.crt", "'/tmp/`touch marker`.crt'"],
    ["/tmp/cert'quote.crt", "'/tmp/cert'\"'\"'quote.crt'"],
  ])("quotes %s as one inert shell argument", (input, expected) => {
    expect(quoteSh(input)).toBe(expected);
  });

  it("compares validated X.509 DER instead of paths, names, or malformed text", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-cert-compare-"));
    try {
      const source = path.join(tmpDir, "source.crt");
      const same = path.join(tmpDir, "same.crt");
      const stale = path.join(tmpDir, "stale.crt");
      const malformed = path.join(tmpDir, "malformed.crt");
      const pem = createCertificate();
      fs.writeFileSync(source, pem);
      fs.writeFileSync(same, pem);
      fs.writeFileSync(stale, createCertificate());
      fs.writeFileSync(malformed, "not a certificate");

      expect(certificatesMatch(source, same)).toBe(true);
      expect(certificatesMatch(source, stale)).toBe(false);
      expect(certificatesMatch(malformed, malformed)).toBe(false);
      expect(certificatesMatch(source, path.join(tmpDir, "missing.crt"))).toBe(false);
      expect(assertDurinDoorRootCertificate(source)).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses trust-store mutation for an arbitrary self-signed CA", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-cert-identity-"));
    try {
      const certPath = path.join(tmpDir, "foreign.crt");
      fs.writeFileSync(certPath, createCertificate("Corporate Root CA"));
      expect(() => assertDurinDoorRootCertificate(certPath)).toThrow(
        "not a DurinDoor MITM root",
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const certutil = findCertutil();
  (certutil ? it : it.skip)("replaces an existing NSS nickname with the exact new Root CA", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-nss-rotation-"));
    const dbDir = path.join(tmpDir, "nssdb");
    const oldPath = path.join(tmpDir, "old.crt");
    const newPath = path.join(tmpDir, "new.crt");
    fs.mkdirSync(dbDir);
    fs.writeFileSync(oldPath, createCertificate());
    fs.writeFileSync(newPath, createCertificate());
    const spec = `sql:${dbDir}`;
    try {
      childProcess.execFileSync(certutil, ["-d", spec, "-N", "--empty-password"]);
      childProcess.execFileSync(certutil, [
        "-d", spec, "-A", "-t", "C,,", "-n", "9Router MITM Root CA", "-i", oldPath,
      ]);

      const expected = assertDurinDoorRootCertificate(newPath);
      await replaceNssCertificate(certutil, spec, newPath, expected);

      const installed = await readNssCertificate(certutil, spec);
      expect(installed.cert.raw.equals(expected.cert.raw)).toBe(true);
      expect(installed.cert.raw.equals(assertDurinDoorRootCertificate(oldPath).cert.raw)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
