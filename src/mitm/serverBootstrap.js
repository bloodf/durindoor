const fs = require("fs");
const { ensureRootCASync, ROOT_CA_CERT_PATH, ROOT_CA_KEY_PATH } = require("./cert/rootCA");
const { ROOT_CA_LOCK_PORT } = require("./config");
const { acquireSocketLock, releaseSocketLock } = require("./startLock");

function readRegularFileNoFollow(filePath, fsImpl = fs) {
  const pathStat = fsImpl.lstatSync(filePath);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new Error(`Unsafe MITM TLS path: ${filePath}`);
  }
  const constants = fsImpl.constants || fs.constants;
  const fd = fsImpl.openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const fileStat = fsImpl.fstatSync(fd);
    if (!fileStat.isFile()
      || String(pathStat.dev) !== String(fileStat.dev)
      || String(pathStat.ino) !== String(fileStat.ino)) {
      throw new Error(`MITM TLS file changed while opening: ${filePath}`);
    }
    return fsImpl.readFileSync(fd);
  } finally {
    fsImpl.closeSync(fd);
  }
}

async function withRootCALock(operation, {
  acquire = () => acquireSocketLock({ port: ROOT_CA_LOCK_PORT }),
  release = releaseSocketLock,
} = {}) {
  const owner = await acquire();
  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  try {
    await release(owner);
  } catch (cleanupError) {
    if (operationError) {
      operationError.cleanupError = cleanupError;
      throw operationError;
    }
    throw cleanupError;
  }
  if (operationError) throw operationError;
  return result;
}

/**
 * Ensure and read the Root CA for the executable MITM entrypoint. This helper
 * deliberately does no logging, listening, signal registration, or exiting so
 * imports and build analysis remain side-effect free.
 */
async function loadRootCATls({
  ensureRootCA = ensureRootCASync,
  readFile = readRegularFileNoFollow,
  keyPath = ROOT_CA_KEY_PATH,
  certPath = ROOT_CA_CERT_PATH,
  withLock = withRootCALock,
  caPrepared = process.env.MITM_CA_PREPARED === "1",
} = {}) {
  return withLock(async () => {
    const generated = caPrepared ? false : await ensureRootCA();
    const key = readFile(keyPath);
    const cert = readFile(certPath);
    return {
      generated,
      key,
      cert,
      rootCAPem: cert.toString("utf8"),
    };
  });
}

module.exports = { loadRootCATls, readRegularFileNoFollow, withRootCALock };
