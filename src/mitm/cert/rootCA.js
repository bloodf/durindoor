const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const forge = require("node-forge");
const { MITM_DIR } = require("../paths");
const { ensureWindowsPrivateDirectorySync } = require("../windowsAcl");

const ROOT_CA_KEY_PATH = path.join(MITM_DIR, "rootCA.key");
const ROOT_CA_CERT_PATH = path.join(MITM_DIR, "rootCA.crt");

function fsyncMitmDirectory() {
  if (process.platform === "win32") return;
  let fd;
  try {
    fd = fs.openSync(MITM_DIR, "r");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function ensurePrivateDirectory() {
  fs.mkdirSync(MITM_DIR, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(MITM_DIR);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe MITM directory: ${MITM_DIR}`);
  }
  if (process.platform !== "win32") fs.chmodSync(MITM_DIR, 0o700);
  else ensureWindowsPrivateDirectorySync(MITM_DIR);
}

function assertRegularFileOrMissing(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe Root CA path: ${filePath}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function rootCAFilesMatchPaths(keyPath, certPath) {
  try {
    const privateKey = forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, "utf8"));
    const certificate = forge.pki.certificateFromPem(fs.readFileSync(certPath, "utf8"));
    return privateKey.n.compareTo(certificate.publicKey.n) === 0
      && privateKey.e.compareTo(certificate.publicKey.e) === 0;
  } catch {
    return false;
  }
}

function rootCAFilesMatch() {
  return rootCAFilesMatchPaths(ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH);
}

function hasValidRootCA() {
  return fs.existsSync(ROOT_CA_KEY_PATH)
    && fs.existsSync(ROOT_CA_CERT_PATH)
    && !isCertExpired(ROOT_CA_CERT_PATH)
    && rootCAFilesMatch();
}

function writeExclusiveTemp(filePath, content, mode, token) {
  const tempPath = `${filePath}.${process.pid}.${token}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", mode);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (process.platform !== "win32") fs.chmodSync(tempPath, mode);
    return tempPath;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore cleanup failure */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup failure */ }
    throw error;
  }
}

function publishRootCAPair(privateKeyPem, certPem) {
  ensurePrivateDirectory();
  assertRegularFileOrMissing(ROOT_CA_KEY_PATH);
  assertRegularFileOrMissing(ROOT_CA_CERT_PATH);

  const token = crypto.randomBytes(12).toString("hex");
  const keyBackup = `${ROOT_CA_KEY_PATH}.${token}.bak`;
  const certBackup = `${ROOT_CA_CERT_PATH}.${token}.bak`;
  const hadKey = fs.existsSync(ROOT_CA_KEY_PATH);
  const hadCert = fs.existsSync(ROOT_CA_CERT_PATH);
  let keyTemp;
  let certTemp;
  let keyBackedUp = false;
  let certBackedUp = false;
  let keyPublished = false;
  let certPublished = false;
  let committed = false;

  try {
    keyTemp = writeExclusiveTemp(ROOT_CA_KEY_PATH, privateKeyPem, 0o600, token);
    certTemp = writeExclusiveTemp(ROOT_CA_CERT_PATH, certPem, 0o644, token);
    if (hadKey) {
      fs.renameSync(ROOT_CA_KEY_PATH, keyBackup);
      keyBackedUp = true;
      if (process.platform !== "win32") fs.chmodSync(keyBackup, 0o600);
    }
    if (hadCert) {
      fs.renameSync(ROOT_CA_CERT_PATH, certBackup);
      certBackedUp = true;
      if (process.platform !== "win32") fs.chmodSync(certBackup, 0o644);
    }
    fs.renameSync(keyTemp, ROOT_CA_KEY_PATH);
    keyPublished = true;
    fs.renameSync(certTemp, ROOT_CA_CERT_PATH);
    certPublished = true;
    if (process.platform !== "win32") {
      fs.chmodSync(ROOT_CA_KEY_PATH, 0o600);
      fs.chmodSync(ROOT_CA_CERT_PATH, 0o644);
    }
    fsyncMitmDirectory();
    committed = true;
  } catch (error) {
    if (!committed) {
      if (keyPublished) {
        try { fs.unlinkSync(ROOT_CA_KEY_PATH); } catch { /* ignore rollback cleanup */ }
      }
      if (certPublished) {
        try { fs.unlinkSync(ROOT_CA_CERT_PATH); } catch { /* ignore rollback cleanup */ }
      }
      if (keyBackedUp) {
        try { fs.renameSync(keyBackup, ROOT_CA_KEY_PATH); } catch { /* preserve original error */ }
      }
      if (certBackedUp) {
        try { fs.renameSync(certBackup, ROOT_CA_CERT_PATH); } catch { /* preserve original error */ }
      }
      try { fsyncMitmDirectory(); } catch { /* preserve original error */ }
    }
    throw error;
  } finally {
    if (keyTemp) {
      try { fs.unlinkSync(keyTemp); } catch { /* already published or absent */ }
    }
    if (certTemp) {
      try { fs.unlinkSync(certTemp); } catch { /* already published or absent */ }
    }
  }

  try {
    const cleanupFailures = [];
    for (const [backupPath, existed] of [[keyBackup, keyBackedUp], [certBackup, certBackedUp]]) {
      if (!existed) continue;
      try {
        fs.unlinkSync(backupPath);
      } catch (error) {
        if (error.code !== "ENOENT") cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      const error = new Error(`Root CA published but ${cleanupFailures.length} backup file(s) could not be removed`);
      error.cause = cleanupFailures[0];
      throw error;
    }
    fsyncMitmDirectory();
  } catch (error) {
    // Publication is already durable. Callers rotating system trust must keep
    // the old-certificate journal for every post-commit failure, including the
    // final directory fsync.
    error.rootCAPublished = true;
    throw error;
  }
}

function listRootCAArtifacts() {
  if (!fs.existsSync(MITM_DIR)) return [];
  return fs.readdirSync(MITM_DIR).flatMap((name) => {
    const match = name.match(/^rootCA\.(key|crt)\.(.+)\.(bak|tmp)$/);
    if (!match) return [];
    const filePath = path.join(MITM_DIR, name);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe Root CA artifact path: ${filePath}`);
    }
    return [{ filePath, kind: match[1], generation: `${match[2]}.${match[3]}`, mtimeMs: stat.mtimeMs }];
  });
}

function cleanupRootCAArtifacts(artifacts = listRootCAArtifacts()) {
  const failures = [];
  for (const artifact of artifacts) {
    try {
      if (process.platform !== "win32" && artifact.kind === "key") fs.chmodSync(artifact.filePath, 0o600);
      fs.unlinkSync(artifact.filePath);
    } catch (error) {
      if (error.code !== "ENOENT") failures.push(error);
    }
  }
  if (failures.length > 0) {
    const error = new Error(`Failed to clean ${failures.length} Root CA recovery artifact(s)`);
    error.cause = failures[0];
    throw error;
  }
}

/**
 * Recover a matching pair left by a process death between pair-publication
 * steps. Normal readers hold the OS-backed Root CA lock while this runs.
 */
function recoverRootCAState() {
  const artifacts = listRootCAArtifacts();
  if (artifacts.length === 0) return false;
  if (hasValidRootCA()) {
    cleanupRootCAArtifacts(artifacts);
    return false;
  }

  const generations = new Map();
  for (const artifact of artifacts) {
    const entry = generations.get(artifact.generation) || { mtimeMs: 0 };
    entry[artifact.kind] = artifact.filePath;
    entry.mtimeMs = Math.max(entry.mtimeMs, artifact.mtimeMs);
    generations.set(artifact.generation, entry);
  }

  const liveKey = fs.existsSync(ROOT_CA_KEY_PATH) ? ROOT_CA_KEY_PATH : null;
  const liveCert = fs.existsSync(ROOT_CA_CERT_PATH) ? ROOT_CA_CERT_PATH : null;
  const candidate = [...generations.values()]
    .map((entry) => ({
      key: entry.key || liveKey,
      cert: entry.crt || liveCert,
      mtimeMs: entry.mtimeMs,
    }))
    .filter((entry) => entry.key && entry.cert && rootCAFilesMatchPaths(entry.key, entry.cert))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];

  if (candidate) {
    publishRootCAPair(
      fs.readFileSync(candidate.key, "utf8"),
      fs.readFileSync(candidate.cert, "utf8"),
    );
  }
  cleanupRootCAArtifacts();
  return Boolean(candidate);
}

/**
 * Check if cert file is expired or expiring within 30 days
 */
function isCertExpired(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, "utf8"));
    const expiryThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return cert.validity.notAfter < expiryThreshold;
  } catch {
    return true; // treat unreadable cert as expired
  }
}

function createRootCAMaterial() {
  // Generate RSA key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create Root CA certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: "9Router MITM Root CA" },
    { name: "organizationName", value: "9Router" },
    { name: "countryName", value: "US" }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed

  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: true,
      critical: true
    },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      critical: true
    },
    {
      name: "subjectKeyIdentifier"
    }
  ]);

  // Self-sign the certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
}

function secureExistingRootCA() {
  ensurePrivateDirectory();
  assertRegularFileOrMissing(ROOT_CA_KEY_PATH);
  assertRegularFileOrMissing(ROOT_CA_CERT_PATH);
  if (process.platform !== "win32") {
    fs.chmodSync(ROOT_CA_KEY_PATH, 0o600);
    fs.chmodSync(ROOT_CA_CERT_PATH, 0o644);
  }
}

function ensureRootCAInternal({ existingMessage, generatingMessage, successMessage }) {
  ensurePrivateDirectory();
  assertRegularFileOrMissing(ROOT_CA_KEY_PATH);
  assertRegularFileOrMissing(ROOT_CA_CERT_PATH);
  recoverRootCAState();
  assertRegularFileOrMissing(ROOT_CA_KEY_PATH);
  assertRegularFileOrMissing(ROOT_CA_CERT_PATH);

  if (hasValidRootCA()) {
    secureExistingRootCA();
    if (existingMessage) console.log(existingMessage);
    return false;
  }

  if (generatingMessage) console.log(generatingMessage);
  const { privateKeyPem, certPem } = createRootCAMaterial();
  publishRootCAPair(privateKeyPem, certPem);
  if (!hasValidRootCA()) throw new Error("Generated Root CA key and certificate do not match");
  if (successMessage) console.log(successMessage);
  return true;
}

/**
 * Generate Root CA certificate (only once, auto-regenerate if expired).
 * This Root CA will sign all dynamic leaf certificates.
 */
function generateRootCA() {
  ensureRootCAInternal({
    existingMessage: "✅ Root CA already exists",
    generatingMessage: "🔐 Generating Root CA certificate...",
    successMessage: "✅ Root CA generated successfully",
  });
  return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
}

/**
 * Load Root CA from disk
 */
function loadRootCA() {
  if (!fs.existsSync(ROOT_CA_KEY_PATH) || !fs.existsSync(ROOT_CA_CERT_PATH)) {
    throw new Error("Root CA not found. Generate it first.");
  }

  const keyPem = fs.readFileSync(ROOT_CA_KEY_PATH, "utf8");
  const certPem = fs.readFileSync(ROOT_CA_CERT_PATH, "utf8");

  return {
    key: forge.pki.privateKeyFromPem(keyPem),
    cert: forge.pki.certificateFromPem(certPem)
  };
}

/**
 * Generate leaf certificate for a specific domain, signed by Root CA
 */
function generateLeafCert(domain, rootCA) {
  // Generate key pair for leaf cert
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create leaf certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 1000000).toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  cert.setSubject([
    { name: "commonName", value: domain }
  ]);

  cert.setIssuer(rootCA.cert.subject.attributes);

  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: false
    },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: domain }, // DNS
        { type: 2, value: `*.${domain}` } // Wildcard
      ]
    }
  ]);

  // Sign with Root CA
  cert.sign(rootCA.key, forge.md.sha256.create());

  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  };
}

/**
 * Synchronous Root CA bootstrap — same logic as generateRootCA() but
 * without an async wrapper, so it can be called at module load time in
 * CommonJS scripts (e.g. server.js) before the event loop is running.
 * Returns true when new keys were written, false when existing keys are
 * still valid, throws on failure.
 */
function ensureRootCASync() {
  return ensureRootCAInternal({
    generatingMessage: "[MITM] Root CA missing, invalid, or expiring — generating now...",
    successMessage: "[MITM] Root CA generated successfully",
  });
}

module.exports = {
  generateRootCA,
  ensureRootCASync,
  loadRootCA,
  generateLeafCert,
  isCertExpired,
  ROOT_CA_CERT_PATH,
  ROOT_CA_KEY_PATH,
  hasValidRootCA,
};
