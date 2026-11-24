import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

const require = createRequire(import.meta.url);
const rootPath = require.resolve("../../src/mitm/cert/rootCA.js");
const pathsPath = require.resolve("../../src/mitm/paths.js");

describe("MITM root CA rotation and name types", () => {
  let dir;
  let root;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mitm-rotation-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    delete require.cache[pathsPath];
    delete require.cache[rootPath];
    root = require(rootPath);
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[rootPath];
    delete require.cache[pathsPath];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(["missing constraints", "noncritical constraints", "long validity", "missing exclusions", "missing server usage"])("rotates a root with %s", (variant) => {
    const { privateKeyPem, certPem } = root.createRootCAMaterial();
    const key = forge.pki.privateKeyFromPem(privateKeyPem);
    const cert = forge.pki.certificateFromPem(certPem);
    if (variant === "missing constraints") cert.extensions = cert.extensions.filter((e) => e.id !== root.NAME_CONSTRAINTS_OID);
    if (variant === "noncritical constraints") cert.getExtension({ id: root.NAME_CONSTRAINTS_OID }).critical = false;
    if (variant === "long validity") cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);
    if (variant === "missing exclusions") {
      const nc = cert.getExtension({ id: root.NAME_CONSTRAINTS_OID });
      const asn = forge.asn1.fromDer(nc.value);
      asn.value.pop();
      nc.value = forge.asn1.toDer(asn).getBytes();
    }
    if (variant === "missing server usage") cert.extensions = cert.extensions.filter((e) => e.name !== "extKeyUsage");
    cert.sign(key, forge.md.sha256.create());
    fs.mkdirSync(path.dirname(root.ROOT_CA_CERT_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(root.ROOT_CA_KEY_PATH, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(root.ROOT_CA_CERT_PATH, forge.pki.certificateToPem(cert));
    expect(root.hasValidRootCA()).toBe(false);
    expect(root.ensureRootCASync()).toBe(true);
    expect(root.hasValidRootCA()).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/rotating.*previous system trust/i));
  });

  it.each([[7, "1.1.1.1", "sslserver"], [1, "person@example.com", "smimesign"]])("rejects a signed name of type %s", (type, value, purpose) => {
    const material = root.createRootCAMaterial();
    const ca = forge.pki.certificateFromPem(material.certPem);
    const key = forge.pki.privateKeyFromPem(material.privateKeyPem);
    const leaf = forge.pki.createCertificate();
    leaf.publicKey = ca.publicKey;
    leaf.serialNumber = "02";
    leaf.validity.notBefore = new Date(Date.now() - 60000);
    leaf.validity.notAfter = new Date(Date.now() + 86400000);
    leaf.setSubject([{ name: "commonName", value: "test" }]);
    leaf.setIssuer(ca.subject.attributes);
    leaf.setExtensions([{ name: "basicConstraints", cA: false }, { name: "subjectAltName", altNames: [{ type, ...(type === 7 ? { ip: value } : { value }) }] }]);
    leaf.sign(key, forge.md.sha256.create());
    const caPath = path.join(dir, "ca.pem");
    const leafPath = path.join(dir, "leaf.pem");
    fs.writeFileSync(caPath, material.certPem);
    fs.writeFileSync(leafPath, forge.pki.certificateToPem(leaf));
    expect(() => execFileSync("openssl", ["verify", "-purpose", purpose, "-CAfile", caPath, leafPath], { stdio: "pipe" })).toThrow();
  });
});
