import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildUnixHostsMutationCommand, buildWindowsHostsMutationScript } = require("../../src/mitm/dns/dnsConfig.js");
const {
  buildElevatedSupervisorScript,
  isAdmin,
  PRIVILEGED_UNCONFIRMED_EXIT_CODE,
  wrapElevatedExecError,
} = require("../../src/mitm/winElevated.js");
const { buildPrivateDirectoryAclScript } = require("../../src/mitm/windowsAcl.js");
const {
  buildMinimalWindowsEnv,
  resolveTrustedUnixBinary,
  resolveWindowsSystemBinary,
} = require("../../src/mitm/trustedBinaries.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("MITM platform privilege boundaries", () => {
  it("builds an atomic, exact-token Windows hosts mutation inside UAC", () => {
    const script = buildWindowsHostsMutationScript({
      action: "add",
      hosts: ["api.example.test", "quote'fixture.example"],
      tag: "fixture",
      hostsFile: "C:\\Windows\\System32\\drivers\\etc\\hosts",
      expectedSha256: "a".repeat(64),
    });
    expect(script).toContain("Test-ExactHostLine");
    expect(script).toContain("[System.IO.File]::Replace($temp, $path, $backup, $true)");
    expect(script).toContain("publication verification failed; original restored");
    expect(script).toContain("quote''fixture.example");
    expect(script).not.toContain("WriteAllText($path");
  });

  it("supervises and terminates the whole elevated PowerShell command tree", () => {
    const script = buildElevatedSupervisorScript(Buffer.from("fixture", "utf16le").toString("base64"), 30000);
    expect(script).toContain("WaitForExit(30000)");
    expect(script).toContain("'C:\\Windows\\System32\\taskkill.exe' /PID $child.Id /T /F");
    expect(script).toContain("process tree could not be terminated");
    expect(script).toContain(`exit ${PRIVILEGED_UNCONFIRMED_EXIT_CODE}`);
  });

  it("bounds Windows elevation detection and fails closed on timeout", () => {
    const execFileSyncImpl = (command, args, options) => {
      expect(command).toBe("C:\\Windows\\System32\\fltmc.exe");
      expect(args).toEqual([]);
      expect(options.timeout).toBe(5000);
      expect(options.env.PATH).toBe("C:\\Windows\\System32;C:\\Windows\\System32\\Wbem");
      throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    };

    expect(isAdmin({ platform: "win32", execFileSyncImpl })).toBe(false);
  });

  it("marks an outer elevated-wrapper timeout as an unconfirmed mutation", () => {
    const error = wrapElevatedExecError(
      Object.assign(new Error("wrapper timeout"), { killed: true, signal: "SIGTERM" }),
      "",
    );
    expect(error).toMatchObject({ code: "PRIVILEGED_TERMINATION_UNCONFIRMED" });
  });

  it("maps the direct-admin and UAC supervisor exit code to quarantine", () => {
    for (const code of [PRIVILEGED_UNCONFIRMED_EXIT_CODE, String(PRIVILEGED_UNCONFIRMED_EXIT_CODE)]) {
      const error = wrapElevatedExecError(Object.assign(new Error("exit"), { code }), "");
      expect(error).toMatchObject({ code: "PRIVILEGED_TERMINATION_UNCONFIRMED" });
    }
    const source = fs.readFileSync(path.join(repoRoot, "src/mitm/winElevated.js"), "utf8");
    expect(source).toContain("$proc.ExitCode -eq ${PRIVILEGED_UNCONFIRMED_EXIT_CODE}");
    expect(source).toContain("exit ${PRIVILEGED_UNCONFIRMED_EXIT_CODE}");
  });

  it("uses trusted absolute entrypoints and drops hostile loader environment", () => {
    expect(resolveWindowsSystemBinary("powershell.exe", {
      env: { SystemRoot: "C:\\Users\\attacker\\fake-windows" },
      verify: false,
    })).toBe("C:\\Windows\\System32\\powershell.exe");
    expect(resolveTrustedUnixBinary("sh")).toMatch(/^\/(?:usr\/)?bin\/(?:sh|dash|bash|ash)$/);
    const env = buildMinimalWindowsEnv({
      LD_PRELOAD: "/tmp/evil",
      DYLD_INSERT_LIBRARIES: "/tmp/evil",
      PSModulePath: "C:\\Users\\attacker\\Modules",
    });
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(env.PSModulePath).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules");
  });

  it("builds compare-and-swap Unix hosts publication without tee truncation", () => {
    const command = buildUnixHostsMutationCommand({
      currentSha256: "a".repeat(64),
      nextBytes: Buffer.from("127.0.0.1 fixture # durindoor-mitm:test\n"),
      hostsFile: "/etc/hosts",
      isMac: false,
    });
    expect(command).toContain("Hosts file changed during mutation");
    expect(command).toContain("mv -f -- \"$temp\" \"$path\"");
    expect(command).toContain("cp --preserve=all -- \"$path\" \"$temp\"");
    expect(command).not.toMatch(/\btee\b/);
  });

  it("replaces Windows MITM directory inheritance with an owner-only ACL", () => {
    const script = buildPrivateDirectoryAclScript("C:\\Users\\fixture\\.9router\\mitm");
    expect(script).toContain("SetAccessRuleProtection($true, $false)");
    expect(script).toContain("S-1-5-18");
    expect(script).toContain("S-1-5-32-544");
    expect(script).toContain("Unexpected MITM directory ACL principal");
  });

  it("keeps the Windows dashboard standard-user policy consistent with the API", () => {
    const serverCard = fs.readFileSync(path.join(
      repoRoot,
      "src/app/(dashboard)/dashboard/cli-tools/components/MitmServerCard.js",
    ), "utf8");
    const toolCard = fs.readFileSync(path.join(
      repoRoot,
      "src/app/(dashboard)/dashboard/cli-tools/components/AntigravityToolCard.js",
    ), "utf8");
    expect(serverCard).toContain("Restart DurinDoor as a standard user");
    expect(serverCard).toContain("proxy stays unprivileged");
    expect(toolCard).toContain("standard-user mode");
    expect(`${serverCard}\n${toolCard}`).not.toContain("as Administrator");
  });

  it("documents the fail-closed privileged-operation recovery contract", () => {
    const troubleshooting = fs.readFileSync(path.join(repoRoot, "docs/troubleshooting.md"), "utf8");
    expect(troubleshooting).toContain("MITM_PRIVILEGED_OPERATION_UNCERTAIN");
    expect(troubleshooting).toContain("~/.durindoor-mitm-state/redirect.json");
    expect(troubleshooting).toContain("%USERPROFILE%\\AppData\\Local\\DurinDoor\\mitm-state\\redirect.json");
    expect(troubleshooting).toContain("Close every DurinDoor process and reboot");
    expect(troubleshooting).toContain("Never raw-kill the recorded PID");
  });
});
