const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const { execFile } = require("child_process");
const { execWithPassword, isSudoAvailable } = require("../dns/dnsConfig.js");
const { runElevatedPowerShell, quotePs } = require("../winElevated.js");
const { log, err } = require("../logger");
const {
  FIXED_UNIX_PATH,
  resolveTrustedUnixBinary,
  resolveWindowsSystemBinary,
} = require("../trustedBinaries");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const LINUX_CERT_PATHS = [
  // Debian / Ubuntu
  { dir: "/usr/local/share/ca-certificates", cmd: "update-ca-certificates" },
  // Arch Linux / CachyOS / Manjaro
  { dir: "/etc/ca-certificates/trust-source/anchors", cmd: "update-ca-trust" },
  // Fedora / RHEL / CentOS
  { dir: "/etc/pki/ca-trust/source/anchors", cmd: "update-ca-trust" },
  // openSUSE
  { dir: "/etc/pki/trust/anchors", cmd: "update-ca-certificates" }
];

function getLinuxCertConfig() {
  for (const config of LINUX_CERT_PATHS) {
    if (fs.existsSync(config.dir)) {
      return config;
    }
  }
  // Fallback to Debian default if none exist
  return LINUX_CERT_PATHS[0];
}

function resolveLinuxSystemCommand(name, { required = true } = {}) {
  return resolveTrustedUnixBinary(name, {
    candidates: [`/usr/sbin/${name}`, `/usr/bin/${name}`, `/sbin/${name}`, `/bin/${name}`],
    required,
  });
}
const ROOT_CA_CN = "9Router MITM Root CA";

function quoteSh(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function readCertificateSnapshot(certPath) {
  const pathStat = fs.lstatSync(certPath);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error(`Unsafe certificate path: ${certPath}`);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(certPath, fs.constants.O_RDONLY | noFollow);
  try {
    const fdStat = fs.fstatSync(fd);
    if (!fdStat.isFile()
      || String(fdStat.dev) !== String(pathStat.dev)
      || String(fdStat.ino) !== String(pathStat.ino)) {
      throw new Error(`Certificate path changed while opening: ${certPath}`);
    }
    const bytes = fs.readFileSync(fd);
    return { bytes, cert: new crypto.X509Certificate(bytes) };
  } finally {
    fs.closeSync(fd);
  }
}

// Get SHA-1 fingerprint from a validated, no-follow certificate snapshot.
function getCertFingerprint(certPath) {
  return readCertificateSnapshot(certPath).cert.fingerprint;
}

function certificatesMatch(sourcePath, installedPath) {
  try {
    const source = readCertificateSnapshot(sourcePath);
    const installed = readCertificateSnapshot(installedPath);
    return source.cert.raw.equals(installed.cert.raw);
  } catch {
    return false;
  }
}

function assertDurinDoorRootCertificate(certPath) {
  const snapshot = readCertificateSnapshot(certPath);
  const { cert } = snapshot;
  const commonNameMatches = cert.subject.split(/\n|,\s*/).some((field) => field === `CN=${ROOT_CA_CN}`);
  if (!commonNameMatches || !cert.ca || cert.issuer !== cert.subject || !cert.verify(cert.publicKey)) {
    throw new Error("Refusing privileged trust-store mutation for a certificate that is not a DurinDoor MITM root");
  }
  return snapshot;
}

/**
 * Check if certificate is already installed in system store
 */
async function checkCertInstalled(certPath) {
  let snapshot;
  try { snapshot = readCertificateSnapshot(certPath); }
  catch { return false; }
  return checkCertificateSnapshotInstalled(certPath, snapshot);
}

function checkCertificateSnapshotInstalled(certPath, snapshot) {
  if (IS_WIN) return checkCertInstalledWindows(snapshot);
  if (IS_MAC) return checkCertInstalledMac(certPath, snapshot);
  return checkCertInstalledLinux(certPath, snapshot);
}

function checkCertInstalledMac(certPath, snapshot) {
  return new Promise((resolve) => {
    try {
      const fingerprint = snapshot.cert.fingerprint.replace(/:/g, "");
      // Verify exact cert bytes match — same CN with different fingerprint = stale cert
      const securityBin = resolveTrustedUnixBinary("security");
      execFile(securityBin, ["find-certificate", "-a", "-c", ROOT_CA_CN, "-Z", "/Library/Keychains/System.keychain"], { windowsHide: true }, (error, stdout) => {
        if (error || !stdout) return resolve(false);
        const match = new RegExp(`SHA-1 hash:\\s*${fingerprint}`, "i").test(stdout);
        if (!match) return resolve(false);
        // Cert exists with matching fingerprint — confirm trust policy
        execFile(securityBin, ["verify-cert", "-c", certPath, "-p", "ssl", "-k", "/Library/Keychains/System.keychain"], { windowsHide: true }, (err2) => {
          resolve(!err2);
        });
      });
    } catch {
      resolve(false);
    }
  });
}

function checkCertInstalledWindows(snapshot) {
  return new Promise((resolve) => {
    const fingerprint = snapshot.cert.fingerprint.replace(/:/g, "");
    execFile(resolveWindowsSystemBinary("certutil.exe"), ["-store", "Root", fingerprint], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Install SSL certificate to system trust store
 */
async function installCert(sudoPassword, certPath) {
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found: ${certPath}`);
  }

  const snapshot = assertDurinDoorRootCertificate(certPath);
  const isInstalled = await checkCertificateSnapshotInstalled(certPath, snapshot);
  if (isInstalled) {
    log("🔐 Cert: already trusted ✅");
    return;
  }

  if (IS_WIN) {
    await installCertWindows(snapshot);
  } else if (IS_MAC) {
    await installCertMac(sudoPassword, snapshot);
  } else {
    await installCertLinux(sudoPassword, certPath, snapshot);
  }
}

async function installCertMac(sudoPassword, snapshot) {
  const encoded = snapshot.bytes.toString("base64");
  const install = `set -eu; umask 077; temp=$(mktemp /var/root/durindoor-mitm-ca.XXXXXX); trap 'rm -f -- "$temp"' EXIT HUP INT TERM; printf '%s' ${quoteSh(encoded)} | base64 -D > "$temp"; security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$temp"`;
  try {
    await execWithPassword(install, sudoPassword);
    log("🔐 Cert: ✅ installed to system keychain");
  } catch (error) {
    const msg = error.message?.includes("canceled") ? "User canceled authorization" : "Certificate install failed";
    throw new Error(msg);
  }
}

async function installCertWindows(snapshot) {
  // Auto-elevate via UAC popup if not admin (zero popup if already admin).
  const encodedDer = snapshot.cert.raw.toString("base64");
  const fingerprint = snapshot.cert.fingerprint.replace(/:/g, "");
  const script = `
    $ErrorActionPreference = 'Stop'
    $bytes = [Convert]::FromBase64String(${quotePs(encodedDer)})
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes)
    if ($cert.Thumbprint -ne ${quotePs(fingerprint)}) { throw 'MITM certificate snapshot fingerprint mismatch' }
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
      $store.Add($cert)
      if (-not ($store.Certificates | Where-Object { $_.Thumbprint -eq ${quotePs(fingerprint)} })) {
        throw 'MITM certificate trust-store publication could not be verified'
      }
    } finally {
      $store.Close()
      $cert.Dispose()
    }
  `;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ installed to Windows Root store");
  } catch (e) {
    throw new Error(`Failed to install certificate: ${e.message}`);
  }
}

/**
 * Uninstall SSL certificate from system store
 */
async function uninstallCert(sudoPassword, certPath) {
  const snapshot = assertDurinDoorRootCertificate(certPath);
  const isInstalled = await checkCertificateSnapshotInstalled(certPath, snapshot);
  if (!isInstalled) {
    log("🔐 Cert: not found in system store");
    return;
  }

  if (IS_WIN) {
    await uninstallCertWindows(snapshot);
  } else if (IS_MAC) {
    await uninstallCertMac(sudoPassword, snapshot);
  } else {
    await uninstallCertLinux(sudoPassword);
  }
}

async function uninstallCertMac(sudoPassword, snapshot) {
  const fingerprint = snapshot.cert.fingerprint.replace(/:/g, "");
  const command = `security delete-certificate -Z "${fingerprint}" /Library/Keychains/System.keychain`;
  try {
    await execWithPassword(command, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from system keychain");
  } catch (err) {
    throw new Error("Failed to uninstall certificate");
  }
}

async function uninstallCertWindows(snapshot) {
  // Auto-elevate via UAC popup if not admin
  const fingerprint = snapshot.cert.fingerprint.replace(/:/g, "");
  const certutilPath = resolveWindowsSystemBinary("certutil.exe", { verify: IS_WIN });
  const script = `
    & ${quotePs(certutilPath)} -delstore Root ${quotePs(fingerprint)} 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "certutil exit $LASTEXITCODE" }
  `;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ uninstalled from Windows Root store");
  } catch (e) {
    throw new Error(`Failed to uninstall certificate: ${e.message}`);
  }
}

async function checkCertInstalledLinux(certPath, sourceSnapshot = null) {
  const config = getLinuxCertConfig();
  const certFile = `${config.dir}/9router-root-ca.crt`;
  const source = sourceSnapshot || readCertificateSnapshot(certPath);
  let systemMatches = false;
  try {
    const installed = readCertificateSnapshot(certFile);
    systemMatches = source.cert.raw.equals(installed.cert.raw);
  } catch { /* system trust file is absent or stale */ }
  const nss = await checkNssDatabases(source);
  if (!isSudoAvailable()) return nss.found && nss.matches;
  return systemMatches && nss.matches;
}

const NSS_CERT_NAME = "9Router MITM Root CA";

function discoverNssDatabaseDirs(home = os.homedir()) {
  const candidates = [
    `${home}/.pki/nssdb`,
    `${home}/snap/chromium/current/.pki/nssdb`,
  ];
  for (const base of [
    `${home}/.mozilla/firefox`,
    `${home}/snap/firefox/common/.mozilla/firefox`,
  ]) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(`${base}/${entry.name}`);
    }
  }
  return [...new Set(candidates)].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
        && (fs.existsSync(`${dir}/cert9.db`) || fs.existsSync(`${dir}/cert8.db`));
    } catch {
      return false;
    }
  });
}

function runCertutil(certutil, args) {
  return new Promise((resolve) => {
    execFile(certutil, args, {
      encoding: "utf8",
      env: { HOME: os.homedir(), PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout = "", stderr = "") => resolve({ error, stdout, stderr }));
  });
}

async function resolveNssDatabaseSpec(certutil, dir) {
  for (const spec of [`sql:${dir}`, dir]) {
    const result = await runCertutil(certutil, ["-d", spec, "-L"]);
    if (!result.error) return spec;
  }
  throw new Error(`Unable to open NSS certificate database: ${dir}`);
}

async function readNssCertificate(certutil, spec) {
  const result = await runCertutil(certutil, ["-d", spec, "-L", "-n", NSS_CERT_NAME, "-a"]);
  if (result.error || !result.stdout.trim()) return null;
  try {
    return { pem: result.stdout, cert: new crypto.X509Certificate(result.stdout) };
  } catch {
    throw new Error(`NSS certificate entry ${NSS_CERT_NAME} is unreadable in ${spec}`);
  }
}

async function deleteNssCertificate(certutil, spec) {
  const existing = await readNssCertificate(certutil, spec);
  if (!existing) return;
  const removed = await runCertutil(certutil, ["-d", spec, "-D", "-n", NSS_CERT_NAME]);
  if (removed.error || await readNssCertificate(certutil, spec)) {
    throw new Error(`Failed to delete stale NSS certificate in ${spec}`);
  }
}

async function replaceNssCertificate(certutil, spec, certPath, expectedSnapshot) {
  const old = await readNssCertificate(certutil, spec);
  if (old?.cert.raw.equals(expectedSnapshot.cert.raw)) return;
  const rollbackDir = fs.mkdtempSync(`${os.tmpdir()}/durindoor-nss-`);
  const rollbackPath = `${rollbackDir}/previous.crt`;
  try {
    if (old) fs.writeFileSync(rollbackPath, old.pem, { mode: 0o600 });
    await deleteNssCertificate(certutil, spec);
    const added = await runCertutil(certutil, [
      "-d", spec, "-A", "-t", "C,,", "-n", NSS_CERT_NAME, "-i", certPath,
    ]);
    const installed = await readNssCertificate(certutil, spec);
    if (added.error || !installed?.cert.raw.equals(expectedSnapshot.cert.raw)) {
      throw new Error(`NSS replacement certificate could not be verified in ${spec}`);
    }
  } catch (error) {
    try {
      await deleteNssCertificate(certutil, spec);
      if (old) {
        const restored = await runCertutil(certutil, [
          "-d", spec, "-A", "-t", "C,,", "-n", NSS_CERT_NAME, "-i", rollbackPath,
        ]);
        const restoredCert = await readNssCertificate(certutil, spec);
        if (restored.error || !restoredCert?.cert.raw.equals(old.cert.raw)) {
          throw new Error("prior NSS certificate restoration could not be verified");
        }
      }
    } catch (rollbackError) {
      throw new Error(`${error.message}; ${rollbackError.message}`);
    }
    throw error;
  } finally {
    fs.rmSync(rollbackDir, { recursive: true, force: true });
  }
}

async function checkNssDatabases(expectedSnapshot) {
  const certutil = resolveLinuxSystemCommand("certutil", { required: false });
  const dirs = certutil ? discoverNssDatabaseDirs() : [];
  if (!certutil || dirs.length === 0) return { found: false, matches: true };
  for (const dir of dirs) {
    const spec = await resolveNssDatabaseSpec(certutil, dir);
    const installed = await readNssCertificate(certutil, spec);
    if (!installed?.cert.raw.equals(expectedSnapshot.cert.raw)) {
      return { found: true, matches: false };
    }
  }
  return { found: true, matches: true };
}

async function updateNssDatabases(certPath, action = "add") {
  const certutil = resolveLinuxSystemCommand("certutil", { required: false });
  if (!certutil) return;
  const dirs = discoverNssDatabaseDirs();
  const expected = action === "add" ? assertDurinDoorRootCertificate(certPath) : null;
  for (const dir of dirs) {
    const spec = await resolveNssDatabaseSpec(certutil, dir);
    if (action === "add") await replaceNssCertificate(certutil, spec, certPath, expected);
    else await deleteNssCertificate(certutil, spec);
  }
}

async function installCertLinux(sudoPassword, certPath, snapshot) {
  if (!isSudoAvailable()) {
    log(`🔐 Cert: cannot install to system store without sudo — trust this file on clients: ${certPath}`);
    // Still try to update user NSS DBs even if no sudo!
    await updateNssDatabases(certPath, 'add');
    return;
  }
  
  const config = getLinuxCertConfig();
  const updateTrust = resolveLinuxSystemCommand(config.cmd);
  const destFile = `${config.dir}/9router-root-ca.crt`;
  const encoded = snapshot.bytes.toString("base64");
  const tempPattern = `${destFile}.durindoor.XXXXXX`;
  const backupPattern = `${destFile}.durindoor-backup.XXXXXX`;
  const cmd = `
    set -eu
    umask 077
    temp=$(mktemp ${quoteSh(tempPattern)})
    backup=$(mktemp ${quoteSh(backupPattern)})
    had_previous=0
    published=0
    cleanup() {
      if [ "$published" -eq 1 ]; then
        if [ "$had_previous" -eq 1 ]; then mv -f -- "$backup" ${quoteSh(destFile)}; else rm -f -- ${quoteSh(destFile)}; fi
        ${quoteSh(updateTrust)} >/dev/null 2>&1 || true
      fi
      rm -f -- "$temp" "$backup"
    }
    trap cleanup EXIT HUP INT TERM
    if [ -f ${quoteSh(destFile)} ]; then
      cp -p -- ${quoteSh(destFile)} "$backup"
      had_previous=1
    fi
    printf '%s' ${quoteSh(encoded)} | base64 -d > "$temp"
    chmod 0644 "$temp"
    mv -f -- "$temp" ${quoteSh(destFile)}
    published=1
    if ${quoteSh(updateTrust)}; then
      published=0
      rm -f -- "$backup"
      had_previous=0
    else
      status=$?
      if [ "$had_previous" -eq 1 ]; then
        mv -f -- "$backup" ${quoteSh(destFile)}
        had_previous=0
      else
        rm -f -- ${quoteSh(destFile)}
      fi
      published=0
      ${quoteSh(updateTrust)} >/dev/null 2>&1 || true
      exit "$status"
    fi
  `;
  
  try {
    await execWithPassword(cmd, sudoPassword);
    await updateNssDatabases(certPath, 'add');
    log(`🔐 Cert: ✅ installed to Linux trust store (${config.dir}) and user browser databases`);
  } catch (error) {
    throw new Error(`Certificate install failed: ${error.message}`);
  }
}

async function uninstallCertLinux(sudoPassword) {
  // Always try to uninstall from user DBs even without sudo
  await updateNssDatabases(null, 'delete');

  if (!isSudoAvailable()) {
    return;
  }
  
  const config = getLinuxCertConfig();
  const updateTrust = resolveLinuxSystemCommand(config.cmd);
  const destFile = `${config.dir}/9router-root-ca.crt`;
  const cmd = `rm -f -- ${quoteSh(destFile)} && ${quoteSh(updateTrust)}`;
  
  try {
    await execWithPassword(cmd, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from Linux trust store and user browser databases");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = {
  installCert,
  uninstallCert,
  checkCertInstalled,
  checkCertInstalledLinux,
  certificatesMatch,
  assertDurinDoorRootCertificate,
  discoverNssDatabaseDirs,
  getCertFingerprint,
  quoteSh,
  readNssCertificate,
  replaceNssCertificate,
  updateNssDatabases,
};
