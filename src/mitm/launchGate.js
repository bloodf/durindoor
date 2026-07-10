const fs = require("fs");
const path = require("path");
const { readFileSnapshot, removeFileIfUnchanged } = require("./startLock");

function fsyncDirectory(filePath, fsImpl = fs) {
  if (process.platform === "win32") return;
  const fd = fsImpl.openSync(path.dirname(filePath), "r");
  try { fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
}

function publishLaunchAuthorization(filePath, nonce, fsImpl = fs) {
  if (!/^[a-f0-9]{48}$/.test(String(nonce || ""))) throw new Error("Invalid MITM launch nonce");
  const fd = fsImpl.openSync(filePath, "wx", 0o600);
  try {
    fsImpl.writeFileSync(fd, `${nonce}\n`);
    fsImpl.fsyncSync(fd);
  } finally {
    fsImpl.closeSync(fd);
  }
  if (process.platform !== "win32") fsImpl.chmodSync(filePath, 0o600);
  fsyncDirectory(filePath, fsImpl);
}

function isParentAlive(pid, processImpl = process) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { processImpl.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM" || error.code === "EACCES"; }
}

async function waitForLaunchAuthorization({
  filePath = process.env.MITM_LAUNCH_GATE_FILE,
  nonce = process.env.MITM_INSTANCE_NONCE,
  managerPid = Number(process.env.MITM_MANAGER_PID),
  timeoutMs = 15000,
  processImpl = process,
  fsImpl = fs,
} = {}) {
  if (!filePath) throw new Error("MITM launch authorization file is required");
  if (!/^[a-f0-9]{48}$/.test(String(nonce || ""))) {
    throw new Error("MITM launch authorization nonce is invalid");
  }
  if (!Number.isSafeInteger(managerPid) || managerPid <= 0) {
    throw new Error("MITM manager PID is invalid");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isParentAlive(managerPid, processImpl)) {
      throw new Error("MITM manager exited before authorizing child listen");
    }
    try {
      const snapshot = readFileSnapshot(filePath, fsImpl);
      if (snapshot.raw === `${nonce}\n`) {
        if (!removeFileIfUnchanged(filePath, snapshot, fsImpl)) {
          throw new Error("MITM launch authorization changed before consumption");
        }
        fsyncDirectory(filePath, fsImpl);
        return true;
      }
      throw new Error("MITM launch authorization nonce mismatch");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("MITM launch authorization timed out");
}

module.exports = { isParentAlive, publishLaunchAuthorization, waitForLaunchAuthorization };
