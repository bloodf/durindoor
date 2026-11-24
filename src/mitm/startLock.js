const fs = require("fs");
const path = require("path");
const { getProcessStartIdentity } = require("./processIdentity");

function createAlreadyStartingError(message = "MITM server is already starting") {
  const error = new Error(message);
  error.code = "MITM_START_IN_PROGRESS";
  return error;
}

/** Acquire an owner-private O_EXCL lockfile, reclaiming only a dead PID's lock. */
function acquireSocketLock({ port, lockPath, directory, fsImpl = fs, pid = process.pid, now = Date.now }) {
  directory = directory || require("./paths").MITM_DIR;
  const filePath = lockPath || path.join(directory, `.${String(port)}.lock`);
  try {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const dirStat = fsImpl.lstatSync(path.dirname(filePath));
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      const error = new Error("Unsafe MITM lock directory");
      error.code = "EINVAL";
      throw error;
    }
    if (process.platform !== "win32") fsImpl.chmodSync(path.dirname(filePath), 0o700);
  } catch (error) {
    return Promise.reject(error);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let fd;
    try {
      fd = fsImpl.openSync(filePath, "wx", 0o600);
      const record = JSON.stringify({ pid, startedAt: now(), startIdentity: getProcessStartIdentity(pid) });
      fsImpl.writeFileSync(fd, record, "utf8");
      fsImpl.fsyncSync(fd);
      const stat = fsImpl.fstatSync(fd);
      fsImpl.closeSync(fd);
      fd = undefined;
      if (process.platform !== "win32") fsImpl.chmodSync(filePath, 0o600);
      return Promise.resolve({ filePath, record, dev: String(stat.dev), ino: String(stat.ino), fsImpl });
    } catch (error) {
      if (fd !== undefined) fsImpl.closeSync(fd);
      if (error.code !== "EEXIST") return Promise.reject(error);
      let snap;
      try {
        snap = readFileSnapshot(filePath, fsImpl);
        const record = JSON.parse(snap.raw);
        if (!Number.isSafeInteger(record.pid) || record.pid <= 0) throw new Error("invalid lock record");
        const currentIdentity = getProcessStartIdentity(record.pid);
        let stale = Boolean(record.startIdentity && currentIdentity !== record.startIdentity);
        if (!record.startIdentity || currentIdentity === record.startIdentity) {
          try {
            process.kill(record.pid, 0);
          } catch (probeError) {
            stale = probeError.code === "ESRCH";
            if (!stale) return Promise.reject(createAlreadyStartingError("MITM server is already starting (lock contention)"));
          }
        }
        if (stale) {
          if (removeFileIfUnchanged(filePath, snap, fsImpl)) continue;
        }
      } catch (readError) {
        if (readError.code === "ENOENT" || readError.code === "EAGAIN") continue;
        return Promise.reject(createAlreadyStartingError("MITM server is already starting (lock contention)"));
      }
      return Promise.reject(createAlreadyStartingError("MITM server is already starting (lock contention)"));
    }
  }
  return Promise.reject(createAlreadyStartingError("MITM server is already starting (lock contention)"));
}

function releaseSocketLock(owner) {
  if (!owner || !owner.filePath) return Promise.resolve(false);
  try {
    const current = readFileSnapshot(owner.filePath, owner.fsImpl || fs);
    if (current.raw !== owner.record
      || current.identity.dev !== owner.dev
      || current.identity.ino !== owner.ino) return Promise.resolve(false);
    return Promise.resolve(removeFileIfUnchanged(owner.filePath, current, owner.fsImpl || fs));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return Promise.resolve(false);
    return Promise.reject(error);
  }
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
