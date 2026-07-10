const { execFileSync } = require("child_process");
const fs = require("fs");
const {
  buildMinimalWindowsEnv,
  resolveWindowsSystemBinary,
} = require("./trustedBinaries");

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPrivateDirectoryAclScript(directory) {
  return `
    $ErrorActionPreference = 'Stop'
    $path = ${quotePs(directory)}
    $item = Get-Item -LiteralPath $path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Unsafe MITM directory path'
    }
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl = Get-Acl -LiteralPath $path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagation = [Security.AccessControl.PropagationFlags]::None
    foreach ($sid in @($current, $system, $admins)) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        $propagation,
        [Security.AccessControl.AccessControlType]::Allow
      )
      [void]$acl.AddAccessRule($rule)
    }
    $acl.SetOwner($current)
    Set-Acl -LiteralPath $path -AclObject $acl

    $verified = Get-Acl -LiteralPath $path
    if (-not $verified.AreAccessRulesProtected) { throw 'MITM directory ACL still inherits foreign access' }
    $allowed = @($current.Value, $system.Value, $admins.Value)
    $hasCurrentFull = $false
    foreach ($rule in @($verified.Access)) {
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($sid -notin $allowed -or $rule.AccessControlType -ne 'Allow') {
        throw "Unexpected MITM directory ACL principal: $sid"
      }
      if ($sid -eq $current.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl)) {
        $hasCurrentFull = $true
      }
    }
    if (-not $hasCurrentFull) { throw 'MITM directory owner lacks full control' }
  `;
}

function ensureWindowsPrivateDirectorySync(directory, {
  platform = process.platform,
  fsImpl = fs,
  execFile = execFileSync,
} = {}) {
  if (platform !== "win32") return;
  const stat = fsImpl.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe MITM directory: ${directory}`);
  const powershell = resolveWindowsSystemBinary("powershell.exe");
  const encoded = Buffer.from(buildPrivateDirectoryAclScript(directory), "utf16le").toString("base64");
  execFile(powershell, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", encoded,
  ], {
    windowsHide: true,
    stdio: "pipe",
    timeout: 15000,
    env: buildMinimalWindowsEnv(),
  });
}

module.exports = { buildPrivateDirectoryAclScript, ensureWindowsPrivateDirectorySync };
