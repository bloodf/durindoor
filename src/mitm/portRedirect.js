const { execFileSync } = require("child_process");
const { resolveWindowsSystemBinary } = require("./trustedBinaries");

function requireNumericUid(processImpl = process) {
  const uid = typeof processImpl.geteuid === "function"
    ? processImpl.geteuid()
    : typeof processImpl.getuid === "function" ? processImpl.getuid() : null;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("Unable to resolve the effective user ID for MITM isolation");
  return uid;
}

function requireWindowsSid(execFileSyncImpl = execFileSync) {
  const output = execFileSyncImpl(
    resolveWindowsSystemBinary("powershell.exe", { verify: process.platform === "win32" }),
    ["-NoProfile", "-NonInteractive", "-Command", "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],
    { encoding: "utf8", windowsHide: true, timeout: 5000 },
  );
  const sid = String(output || "").trim();
  if (!/^S-\d(?:-\d+){2,14}$/.test(sid)) throw new Error("Unable to resolve a safe Windows owner SID for MITM isolation");
  return sid;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function buildMacRedirect({ uid, publicPort, internalPort, allowExisting = true }) {
  const anchor = `com.apple/durindoor.mitm.${uid}`;
  const rules = [
    `rdr on lo0 inet proto tcp from any to 127.0.0.1 port ${publicPort} -> 127.0.0.1 port ${internalPort}`,
    `block return out quick on lo0 inet proto tcp from any to 127.0.0.1 port { ${publicPort}, ${internalPort} } user != ${uid}`,
  ].join("\n");
  return {
    anchor,
    install: `set -eu; pfctl -s info 2>/dev/null | grep -q '^Status: Enabled'; ${allowExisting ? "" : `nat=$(pfctl -a ${anchor} -sn 2>/dev/null); filter=$(pfctl -a ${anchor} -sr 2>/dev/null); [ -z "$nat" ] && [ -z "$filter" ] || { echo 'A MITM PF rule already exists for this user' >&2; exit 76; };`} printf '%s\\n' ${shellQuote(rules)} | pfctl -a ${anchor} -f -`,
    remove: `set -eu; pfctl -a ${anchor} -F all; nat=$(pfctl -a ${anchor} -sn 2>/dev/null); filter=$(pfctl -a ${anchor} -sr 2>/dev/null); [ -z "$nat" ] && [ -z "$filter" ] || { echo 'DurinDoor PF anchor remains active' >&2; exit 1; }`,
  };
}

function linuxRuleParts({ uid, publicPort, internalPort }) {
  const tag = `durindoor-mitm-${uid}`;
  return {
    tag,
    nat: `-t nat -p tcp -d 127.0.0.1 --dport ${publicPort} -m owner --uid-owner ${uid} -m comment --comment ${tag} -j REDIRECT --to-ports ${internalPort}`,
    deny: `-p tcp -d 127.0.0.1 -m multiport --dports ${publicPort},${internalPort} -m owner ! --uid-owner ${uid} -m comment --comment ${tag} -j REJECT --reject-with tcp-reset`,
  };
}

function buildLinuxRedirect(options) {
  const { nat, deny } = linuxRuleParts(options);
  const allowExisting = options.allowExisting !== false;
  return {
    install: allowExisting ? [
        "set -eu",
        `iptables -w 5 -t nat -C OUTPUT ${nat.replace(/^-t nat /, "")} 2>/dev/null || iptables -w 5 -t nat -I OUTPUT 1 ${nat.replace(/^-t nat /, "")}`,
        `iptables -w 5 -C OUTPUT ${deny} 2>/dev/null || iptables -w 5 -I OUTPUT 1 ${deny}`,
        `iptables -w 5 -t nat -C OUTPUT ${nat.replace(/^-t nat /, "")} >/dev/null`,
        `iptables -w 5 -C OUTPUT ${deny} >/dev/null`,
      ].join("; ") : [
        "set -eu",
        `if iptables -w 5 -t nat -C OUTPUT ${nat.replace(/^-t nat /, "")} 2>/dev/null || iptables -w 5 -C OUTPUT ${deny} 2>/dev/null; then echo 'A MITM iptables rule already exists for this user' >&2; exit 76; fi`,
        "nat_added=0; deny_added=0",
        `cleanup() { if [ "$deny_added" -eq 1 ]; then iptables -w 5 -D OUTPUT ${deny} 2>/dev/null || true; fi; if [ "$nat_added" -eq 1 ]; then iptables -w 5 -t nat -D OUTPUT ${nat.replace(/^-t nat /, "")} 2>/dev/null || true; fi; }`,
        "trap cleanup EXIT HUP INT TERM",
        `iptables -w 5 -t nat -I OUTPUT 1 ${nat.replace(/^-t nat /, "")}; nat_added=1`,
        `iptables -w 5 -I OUTPUT 1 ${deny}; deny_added=1`,
        `iptables -w 5 -t nat -C OUTPUT ${nat.replace(/^-t nat /, "")} >/dev/null`,
        `iptables -w 5 -C OUTPUT ${deny} >/dev/null`,
        "deny_added=0; nat_added=0; trap - EXIT HUP INT TERM",
      ].join("; "),
    remove: [
      "set -eu",
      `if iptables -w 5 -t nat -C OUTPUT ${nat.replace(/^-t nat /, "")} 2>/dev/null; then iptables -w 5 -t nat -D OUTPUT ${nat.replace(/^-t nat /, "")}; fi`,
      `if iptables -w 5 -C OUTPUT ${deny} 2>/dev/null; then iptables -w 5 -D OUTPUT ${deny}; fi`,
      `if iptables -w 5 -t nat -C OUTPUT ${nat.replace(/^-t nat /, "")} 2>/dev/null; then echo 'DurinDoor MITM NAT rule remains installed' >&2; exit 1; fi`,
      `if iptables -w 5 -C OUTPUT ${deny} 2>/dev/null; then echo 'DurinDoor MITM isolation rule remains installed' >&2; exit 1; fi`,
    ].join("; "),
  };
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsFirewallIdentity(sid) {
  return {
    name: `DurinDoor-MITM-Isolation-${sid}`,
    localUser: `D:(D;;CC;;;${sid})(A;;CC;;;WD)`,
  };
}

function buildWindowsFirewallVerification({ name, localUser, publicPort }) {
  return `
    $rule = Get-NetFirewallRule -Name ${quotePowerShell(name)} -PolicyStore ActiveStore -ErrorAction SilentlyContinue
    if ($null -eq $rule) { throw 'DurinDoor MITM isolation rule is missing' }
    $portFilter = $rule | Get-NetFirewallPortFilter
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    $securityFilter = $rule | Get-NetFirewallSecurityFilter
    $expectedUserDescriptor = [System.Security.AccessControl.CommonSecurityDescriptor]::new($false, $false, ${quotePowerShell(localUser)}).GetSddlForm([System.Security.AccessControl.AccessControlSections]::All)
    $actualUserDescriptor = [System.Security.AccessControl.CommonSecurityDescriptor]::new($false, $false, [string]$securityFilter.LocalUser).GetSddlForm([System.Security.AccessControl.AccessControlSections]::All)
    if ($rule.Direction -ne 'Outbound' -or $rule.Action -ne 'Block' -or $rule.Enabled -ne 'True'
      -or [string]$portFilter.Protocol -notin @('TCP', '6')
      -or [string]$portFilter.RemotePort -ne '${publicPort}'
      -or [string]$addressFilter.RemoteAddress -ne '127.0.0.1'
      -or $actualUserDescriptor -ne $expectedUserDescriptor) {
      throw 'A foreign or malformed rule occupies the DurinDoor MITM isolation identity'
    }
  `;
}

function buildWindowsRedirect({ sid, publicPort, allowExisting = true }) {
  const { name, localUser } = windowsFirewallIdentity(sid);
  const verify = buildWindowsFirewallVerification({ name, localUser, publicPort });
  return {
    name,
    install: `
      $ErrorActionPreference = 'Stop'
      $existing = Get-NetFirewallRule -Name ${quotePowerShell(name)} -PolicyStore ActiveStore -ErrorAction SilentlyContinue
      $created = $false
      if ($null -ne $existing -and ${allowExisting ? "$false" : "$true"}) {
        throw 'A DurinDoor MITM firewall rule already exists for this user'
      }
      if ($null -eq $existing) {
        New-NetFirewallRule -Name ${quotePowerShell(name)} -DisplayName 'DurinDoor MITM cross-user isolation' -Description 'Blocks non-owner loopback access to the user-owned MITM proxy.' -Direction Outbound -Action Block -Protocol TCP -RemoteAddress 127.0.0.1 -RemotePort ${publicPort} -LocalUser ${quotePowerShell(localUser)} -Profile Any -ErrorAction Stop | Out-Null
        $created = $true
      }
      try {
        ${verify}
      } catch {
        if ($created) {
          Remove-NetFirewallRule -Name ${quotePowerShell(name)} -ErrorAction SilentlyContinue
        }
        throw
      }
    `,
    remove: `
      $ErrorActionPreference = 'Stop'
      $existing = Get-NetFirewallRule -Name ${quotePowerShell(name)} -PolicyStore ActiveStore -ErrorAction SilentlyContinue
      if ($null -ne $existing) {
        ${verify}
        Remove-NetFirewallRule -Name ${quotePowerShell(name)} -ErrorAction Stop
        if ($null -ne (Get-NetFirewallRule -Name ${quotePowerShell(name)} -PolicyStore ActiveStore -ErrorAction SilentlyContinue)) {
          throw 'DurinDoor MITM isolation rule removal could not be verified'
        }
      }
    `,
  };
}

module.exports = {
  buildLinuxRedirect,
  buildMacRedirect,
  buildWindowsRedirect,
  linuxRuleParts,
  requireNumericUid,
  requireWindowsSid,
  windowsFirewallIdentity,
};
