const fs = require("fs");
const net = require("net");

function createAlreadyStartingError(message = "MITM server is already starting") {
  const error = new Error(message);
  error.code = "MITM_START_IN_PROGRESS";
  return error;
}

/**
 * Use a loopback listener as the cross-process startup mutex. The operating
 * system releases the port on process death, so there is no stale file to
 * reclaim and no compare/unlink race that can delete a successor's lock.
 */
function acquireSocketLock({ port, host = "127.0.0.1", netImpl = net }) {
  return new Promise((resolve, reject) => {
    const server = netImpl.createServer();
    const onError = (error) => {
      if (error.code === "EADDRINUSE") {
        reject(createAlreadyStartingError("MITM server is already starting (lock contention)"));
      } else {
        reject(error);
      }
    };

    server.once("error", onError);
    server.listen({ host, port, exclusive: true }, () => {
      server.removeListener("error", onError);
      // A later listener error must not become an unhandled process error.
      server.on("error", () => {});
      server.unref?.();
      resolve({ server, host, port });
    });
  });
}

function releaseSocketLock(owner) {
  return new Promise((resolve, reject) => {
    try {
      owner.server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    } catch (error) {
      if (error.code === "ERR_SERVER_NOT_RUNNING") resolve(false);
      else reject(error);
    }
  });
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Read a regular file without following a symlink. These helpers protect PID
 * metadata only; startup mutual exclusion is provided by acquireSocketLock.
 */
function readFileSnapshot(filePath, fsImpl = fs) {
  const pathStat = fsImpl.lstatSync(filePath);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    const error = new Error(`Unsafe MITM metadata path: ${filePath}`);
    error.code = "EINVAL";
    throw error;
  }

  const constants = fsImpl.constants || fs.constants;
  const noFollow = constants.O_NOFOLLOW || 0;
  const fd = fsImpl.openSync(filePath, constants.O_RDONLY | noFollow);
  try {
    const fileStat = fsImpl.fstatSync(fd);
    if (String(pathStat.dev) !== String(fileStat.dev) || String(pathStat.ino) !== String(fileStat.ino)) {
      const error = new Error("MITM metadata changed while opening");
      error.code = "EAGAIN";
      throw error;
    }
    return {
      identity: statIdentity(fileStat),
      raw: fsImpl.readFileSync(fd, "utf8"),
    };
  } finally {
    fsImpl.closeSync(fd);
  }
}

function sameSnapshot(left, right) {
  return left.raw === right.raw
    && left.identity.dev === right.identity.dev
    && left.identity.ino === right.identity.ino
    && left.identity.size === right.identity.size
    && left.identity.mtimeMs === right.identity.mtimeMs;
}

function removeFileIfUnchanged(filePath, snapshot, fsImpl = fs) {
  let current;
  try {
    current = readFileSnapshot(filePath, fsImpl);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!sameSnapshot(snapshot, current)) return false;
  try {
    fsImpl.unlinkSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Atomically replace metadata only when the record observed by the caller is
 * still current. Legitimate writers hold the OS operation gate; this identity
 * check additionally refuses unexpected same-directory changes.
 */
function replaceFileIfUnchanged(filePath, snapshot, replacementPath, fsImpl = fs) {
  let current;
  try {
    current = readFileSnapshot(filePath, fsImpl);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!sameSnapshot(snapshot, current)) return false;
  fsImpl.renameSync(replacementPath, filePath);
  return true;
}

/**
 * Coordinate the process-local operation latch with the OS-backed lock. Start
 * calls reject concurrent local work; stop calls can wait and then claim the
 * same local/cross-process operation gate through runAfterIdle().
 */
function createStartGate({ acquire, release, onCleanupError = async () => {} }) {
  let starting = false;
  let idlePromise = Promise.resolve();

  async function execute(start, waitForCurrent) {
    if (waitForCurrent) {
      while (starting) await idlePromise;
    } else if (starting) {
      throw createAlreadyStartingError();
    }

    // No await occurs between the state check and claim, making this atomic
    // with respect to other JavaScript callbacks in this process.
    if (starting) throw createAlreadyStartingError();
    starting = true;
    let resolveIdle;
    idlePromise = new Promise((resolve) => { resolveIdle = resolve; });

    let owner;
    let value;
    let operationError;
    let cleanupError;
    try {
      owner = await acquire();
      value = await start(owner);
    } catch (error) {
      operationError = error;
    }

    try {
      if (owner) await release(owner);
    } catch (error) {
      cleanupError = error;
      try {
        await onCleanupError(error);
      } catch (rollbackError) {
        cleanupError.rollbackError = rollbackError;
      }
    } finally {
      starting = false;
      resolveIdle();
    }

    if (operationError) {
      if (cleanupError) operationError.cleanupError = cleanupError;
      throw operationError;
    }
    if (cleanupError) throw cleanupError;
    return value;
  }

  return {
    run(start) {
      return execute(start, false);
    },
    runAfterIdle(operation) {
      return execute(operation, true);
    },
    isStarting() {
      return starting;
    },
    waitForIdle() {
      return idlePromise;
    },
  };
}

module.exports = {
  acquireSocketLock,
  createAlreadyStartingError,
  createStartGate,
  readFileSnapshot,
  releaseSocketLock,
  replaceFileIfUnchanged,
  removeFileIfUnchanged,
};
