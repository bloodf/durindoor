const fs = require("fs");
const path = require("path");

const FIXED_UNIX_PATH = "/usr/sbin:/usr/bin:/sbin:/bin";
// Fail closed on non-standard Windows installations rather than trusting the
// mutable SystemRoot/WINDIR environment across a UAC boundary. The canonical
// system installation path is protected by Windows ACLs.
const WINDOWS_SYSTEM_ROOT = "C:\\Windows";

const UNIX_CANDIDATES = Object.freeze({
  sh: ["/bin/sh", "/bin/dash", "/usr/bin/dash", "/bin/bash", "/bin/ash"],
  sudo: ["/usr/bin/sudo", "/bin/sudo"],
  lsof: ["/usr/sbin/lsof", "/usr/bin/lsof", "/sbin/lsof"],
  ps: ["/bin/ps", "/usr/bin/ps"],
  kill: ["/bin/kill", "/usr/bin/kill"],
  launchctl: ["/bin/launchctl"],
  security: ["/usr/bin/security"],
});

function isTrustedUnixFile(filePath, { fsImpl = fs } = {}) {
  try {
    const linkStat = fsImpl.lstatSync(filePath);
    if (!linkStat.isFile() && !linkStat.isSymbolicLink?.()) return false;
    if (typeof linkStat.uid === "number" && linkStat.uid !== 0) return false;
    const resolved = fsImpl.realpathSync(filePath);
    const stat = fsImpl.statSync(resolved);
    if (!stat.isFile()) return false;
    if (typeof stat.uid === "number" && stat.uid !== 0) return false;
    if ((stat.mode & 0o022) !== 0) return false;
    fsImpl.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveTrustedUnixBinary(name, {
  candidates = UNIX_CANDIDATES[name] || [],
  fsImpl = fs,
  required = true,
} = {}) {
  const match = candidates.find((candidate) => isTrustedUnixFile(candidate, { fsImpl }));
  if (match) return fsImpl.realpathSync(match);
  if (!required) return null;
  throw new Error(`No trusted root-owned ${name} binary is available`);
}

function resolveWindowsSystemBinary(name, {
  fsImpl = fs,
  verify = process.platform === "win32",
  systemRoot = WINDOWS_SYSTEM_ROOT,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+\.exe$/i.test(String(name || ""))) {
    throw new Error("Unsafe Windows system binary name");
  }
  const root = String(systemRoot);
  if (!path.win32.isAbsolute(root) || /[\r\n"']/u.test(root)) {
    throw new Error("Unsafe Windows system root");
  }
  const binary = path.win32.join(path.win32.normalize(root), "System32", name);
  if (verify) {
    const stat = fsImpl.lstatSync(binary);
    if (!stat.isFile() || stat.isSymbolicLink?.()) {
      throw new Error(`Unsafe Windows system binary: ${binary}`);
    }
  }
  return binary;
}

function buildMinimalWindowsEnv(env = process.env) {
  const systemRoot = WINDOWS_SYSTEM_ROOT;
  const system32 = path.win32.join(systemRoot, "System32");
  const modules = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules");
  return Object.fromEntries(Object.entries({
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: path.win32.join(system32, "cmd.exe"),
    PATH: `${system32};${path.win32.join(systemRoot, "System32", "Wbem")}`,
    PSModulePath: modules,
    TEMP: env.TEMP,
    TMP: env.TMP,
    USERPROFILE: env.USERPROFILE,
  }).filter(([, value]) => value));
}

module.exports = {
  buildMinimalWindowsEnv,
  FIXED_UNIX_PATH,
  WINDOWS_SYSTEM_ROOT,
  UNIX_CANDIDATES,
  isTrustedUnixFile,
  resolveTrustedUnixBinary,
  resolveWindowsSystemBinary,
};
