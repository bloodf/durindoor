# macOS browser-shard process cleanup design (#2661)

## Status

**Open design. Not safe for implementation.** An independent safety review of the first draft (bcc6d30616) found that its "proposed guarantee" was not established. That draft reaped the identity-pinning child too early. It also used a circular completion test, ignored the real Playwright topology and treated a free port as proof of cleanup. This revision replaces that guarantee with explicit open questions, then gives the disposable fixtures that must pass before any guarantee is claimed.

No process was started or signalled for this revision. No product code, setting, or service changed. The evidence comes from reading this repository, the installed Playwright 1.63.0 and Next 16.4.5 sources under `website/node_modules/.pnpm/`, and public manual pages. Every statement is labelled:

- **[fact: code]** comes from reading source in this checkout, with its location.
- **[fact: doc]** comes from a platform manual or Node documentation. It must still be confirmed on the target macOS SDK.
- **[hypothesis]** is unproven. A fixture in [the fixture plan](#native-disposable-fixture-plan) must confirm or refute it.
- **[open]** is an unresolved design decision.

The Linux implementation is [`scripts/lib/website-shard-server.mjs`](../../scripts/lib/website-shard-server.mjs). Do not port its `/proc` algorithm to macOS, and do not parse `ps` output.

## Real process topology

```text
local-ci (L)                         scripts/local-ci.mjs run()
 │ spawn(node, [playwright cli test --shard=i/n], detached:true,
 │       stdio:[ignore, logfd, logfd])                     ── session S1 / group G1
 ▼
Playwright runner (R)  [leader of G1]
 ├─ fork → test worker W1, W2 (workers: 2)                 ── stay in G1
 │    └─ launchProcess(chromium, detached:true,
 │         stdio: ignore + pipes incl. fd3/fd4 CDP)        ── session/group G3, G4…
 │         └─ Chromium helper processes                    ── group unknown on macOS
 └─ webServer: launchProcess("<node> transient-server.mjs --port N",
        shell:true, detached:true, stdio: 3 pipes to R)    ── session S2 / group G2
      /bin/sh -c …  (SH) [leader of G2]  (exec or not: unknown on macOS)
       └─ transient launcher (T, node)                     ── G2
            └─ spawn(node next start, stdio:[ignore, inherit, inherit]) ── G2
                 Next server (N) — writes into R's stdout/stderr pipes
```

**Facts about this topology:**

- **[fact: code]** local-ci spawns each shard with `detached: true` and the log file as stdout/stderr (`scripts/local-ci.mjs` `run()`). The runner's output therefore goes to a file, not a pipe. On the 300 s budget or the 180 s silence watchdog, local-ci sends `SIGKILL` to `-pid` (G1). On SIGINT/SIGTERM it sends `SIGTERM` to G1. After the child's `close` event, it always calls `terminateCommandGroup(pid)`, which sends `SIGKILL` to G1.
- **[fact: doc]** Node documents `detached: true` on non-Windows as making the child the leader of a new process group **and session**.
- **[fact: code]** Playwright `launchProcess` (`playwright-core/lib/coreBundle.js`, around lines 9312–9430) spawns with `detached: process.platform !== "win32"`. The webServer plugin (`playwright/lib/runner/index.js`, around lines 870–900) passes `shell: true` and `stdio: "stdin"`, which gives three pipes.
- **[fact: code]** Playwright's webServer shutdown authority works this way: `gracefulShutdown` sends `kill(-G2, SIGTERM)` and waits up to 5 s for `close`. If `close` doesn't arrive, `killProcess()` sends `kill(-G2, SIGKILL)`. `killProcess` skips the signal once Playwright has seen `close`. An `exit` handler installed by `launchProcess` also sends `SIGKILL` to `-G2` when R exits normally. An R that is killed with SIGKILL runs none of this.
- **[fact: code]** Node's `close` fires only after the child exits **and** all of its stdio streams close. N inherits R's stdout/stderr pipes from T, so `close` on SH waits for N too.
- **[fact: code]** T spawns N without `detached`, so N stays in G2. T has its own `SIGTERM`/`SIGINT` handler, which runs `server.stop()`: `SIGTERM` to N, then `SIGKILL` after 5 s. T also runs a runner watcher, `watchRunner`, that stops N when R disappears.
- **[fact: code]** Browsers are launched by workers in **their own** sessions/groups (G3, G4…), not in G1 or G2. local-ci's `SIGKILL` to G1 does not reach them.
- **[fact: code]** In Next 16.4.5, `next start` calls `startServer` in-process. In the inspected path, `start-server.js` uses `child_process.exec` only for the port-in-use diagnostic (`lsof`/`netstat`). **[hypothesis]** N creates no other long-lived children in this suite. The source doesn't rule out dynamic children such as image tooling or workers.
- **[hypothesis]** On supported macOS releases, `/bin/sh -c "single command"` may or may not `exec` the command. That decides whether SH or T leads G2.
- **[hypothesis]** On macOS, Chromium helper processes stay in the browser's group/session, and the browser exits when its CDP pipe reaches EOF after a worker dies.

**Shutdown authorities over the server today.** G2 currently has four uncoordinated authorities:

1. R's `gracefulShutdown` and `killProcess` (`SIGTERM` and `SIGKILL` to the whole group).
2. T's signal handler and `server.stop()`.
3. T's `watchRunner`.
4. On Linux only, local-ci's token-and-procfs cleanup.

A macOS supervisor would add a fifth. **[open]** The design must state which authority wins and must remove or fence the others. Otherwise Playwright's `SIGKILL` to `-G2` can kill the supervisor itself (see [requirement 3](#3-place-the-helper-outside-every-group-another-component-force-kills)).

## Pre-existing observations (not fixed here)

- **[fact: code]** `local-ci.mjs` sends `SIGKILL` to `-child.pid` **after** Node has reaped the runner (`close` was already emitted). If every G1 member is gone by then, that number may be reused as another group's ID, so the signal can reach a foreign group. This is the same "signal after reap" pattern that requirement 1 below forbids. Track it separately and don't change it in this investigation.
- **[fact: code]** `watchRunner` in `website/scripts/transient-server.mjs` reads start time from `/proc/<pid>/stat`. macOS has no procfs, so `processStartTime` returns `null` there and liveness falls back to `kill(pid, 0)`. This creates two problems:
  - A recycled R PID makes the watcher believe the runner is still alive, so the server is never stopped.
  - `EPERM` is also treated as alive.

  The watcher is a polling PID check with no identity on macOS, and nothing may rely on it there.

## Requirements and their current status

### 1. Never reap the pin before the last possible group signal

The supervisor (H) pins the server group's ID by keeping its leader (`LS`) as an **unreaped child**. A zombie keeps its PID, so `LS`'s PID can't become a new group ID while it's unreaped. **[fact: doc]** Rules:

- Every `killpg(GS, …)` must happen while `LS` is unreaped. After `LS` is reaped, H must never signal `GS` again, not even on a retry, timeout, or error path.
- `waitpid(LS, &st, WNOHANG)` **reaps** an exited child. **[fact: doc]** It must not be used to "check" the leader during cleanup. The same applies to `wait`, `wait3`/`wait4`, and any `waitpid` without `WNOWAIT`-style semantics.
- **[hypothesis]** Two mechanisms can observe exit without reaping: `waitid(P_PID, LS, &info, WEXITED | WNOHANG | WNOWAIT)` and `kqueue` `EVFILT_PROC`/`NOTE_EXIT`. Both must be verified on each supported macOS version. Apple's `waitid` man page lists `WNOWAIT`, but its behaviour isn't verified until fixture F1 passes. If neither is reliable, the design has no non-reaping exit observer and stays blocked.
- H must reset `SIGCHLD` to `SIG_DFL` and must never set `SA_NOCLDWAIT`. **[fact: doc]** A `SIG_IGN` disposition for `SIGCHLD` survives `exec` and causes automatic reaping, which would silently drop the pin.
- The only reaping call is one final blocking `waitpid(LS, …, 0)`. It runs after the completion predicate succeeds, or after H has decided to fail closed and will send no further signal.

### 2. Non-circular completion predicate for grandchildren

`killpg` returning 0 only means the signal was queued for at least one member. It does not prove that any process exited. **[fact: doc]** `kill(-GS, 0)` can't be the completion test either: the zombie leader that keeps the pin may itself make the group look non-empty. The test would then never pass, or it would pass only because the pin was released. **[hypothesis]** That behaviour is unverified on macOS.

**Proposed predicate [hypothesis, to be proven by F4/F5].** The tree counts as gone only when all of these hold in one pass:

- `sysctl {CTL_KERN, KERN_PROC, KERN_PROC_PGRP, GS}` succeeds without truncation. It returns exactly one `kinfo_proc`, whose PID is `LS` and whose `p_stat` is `SZOMB`.
- A session-scoped enumeration of `LS`'s session returns the same single zombie. Candidates are `KERN_PROC_SESSION` or `proc_listpgrppids` with per-PID `proc_pidinfo`; which one to use is **[open]**. This catches members that moved to a different group but stayed in the session. Such a member could later `setpgid` back into `GS`.
- `LS` is still unreaped, as confirmed by F1's non-reaping observer.

**Fail closed.** Any of the following counts as **not complete**: a sysctl error, a size race, an unknown `p_stat`, an entry from a different uid, or a mismatch between the two enumerations. After the bounded deadline, H reports failure with the enumerated survivors. Only then does it reap, and it never signals again afterwards. Whether a zombie leader appears in `KERN_PROC_PGRP` and `KERN_PROC_SESSION` results is **[hypothesis]**.

### 3. Place the helper outside every group another component force-kills

**[fact: code]** If H is started as the Playwright `webServer` command, it lands in G2. Playwright then sends `SIGKILL` to H on shutdown timeout or on normal exit. H must not be in G1 (local-ci's `SIGKILL` target) or in G2.

Candidate placements, all **[open]**:

- **(a) H calls `setsid()` itself after Playwright spawns it**, then spawns the server in another new session.
  - Playwright's `-G2` signals reach only SH, and SH has no server to signal.
  - H must hold R's stdio pipes or use a dedicated control pipe. R's `close` would then wait for H, so R's teardown is bounded only by H's deadline, and that deadline must stay below local-ci's budget.
  - Playwright still believes it owns the server. Its graceful-shutdown signal goes to a group that no longer holds the server.
- **(b) local-ci starts H before the shard**, and Playwright attaches to an external server. This conflicts with the current `reuseExistingServer: false` and "never attach" contract in `website/playwright.config.mjs`, so that contract would have to change explicitly.
- **(c) A small in-group lifeline shim.** H passes a pipe to a shim inside `GS`. When the pipe reaches EOF, the shim calls `kill(0, SIGKILL)`. This addresses the caller's own group without using a PID, so PID reuse can't misdirect it.
  - It is the only candidate that still works after H crashes (see requirement 7).
  - It is still blind to `setsid`/`setpgid` escapees, and the shim itself can be killed.

**[open]** Exactly one shutdown authority must remain over the server group. The design must also say whether T's handler and `watchRunner` are kept (as a fast path) or removed on macOS.

### 4. A free port proves little

A free loopback port does **not** show any of the following:

- That non-listening descendants exited.
- That a child which called `setsid` or `setpgid` (a "detached" child) exited.
- That a member of the session in another group exited.
- That a process which closed its listener but is still running exited.

A port probe may be used only to detect a **foreign** listener, which is then never signalled.

**[fact: doc]** POSIX groups and sessions are not containment. Any descendant can leave with `setsid`. macOS offers no unprivileged kernel handle that tracks a whole process tree. `NOTE_TRACK` is documented as unsupported, and Endpoint Security needs an entitlement. **[hypothesis]** Enumerating children recursively with `proc_listchildpids` is racy and loses the link when a process reparents to `launchd`.

**Bounded supported-process contract [open, proposal].** Full-tree cleanup is claimed only for a declared supported tree: SH or T, then T, then Next `start`. That tree must:

- Make no `setsid`/`setpgid` call. Fixture F12 records this.
- Keep every process in `GS` and `SS`.

Anything that escapes the session is outside the guarantee. H checks this best-effort at checkpoints (enumerating descendants with the same uid by parent links before signalling) and fails closed if it finds a violation. An escape it never sees remains a documented residual. No full-tree claim stands without either this contract or a stronger mechanism.

### 5. Descriptors, pipe EOF, blocked output and SIGPIPE

- **EOF as the runner-death signal.** EOF happens only when every write end is closed. If R's write end leaks into W1/W2, browsers, SH, T or N, EOF is delayed until those processes die.
  - **[hypothesis]** libuv on macOS creates its descriptors with `O_CLOEXEC`/`FD_CLOEXEC` and passes only the fds it names.
  - H must spawn the server with `POSIX_SPAWN_CLOEXEC_DEFAULT`, an Apple extension (**[fact: doc]**, to be verified in the SDK headers), and with explicit file actions for fds 0, 1 and 2, so H's control descriptors never reach the server tree.
- **Blocked output.** N writes into R's pipes today. If R stops reading, the pipe buffer fills.
  - **[hypothesis]** Node writes to pipes asynchronously on macOS. Node documents pipes as synchronous only on Linux. Memory would grow instead of N blocking, which still needs verification.
  - A synchronous writer such as a native child or SH would block. While blocked it can't exit cleanly, though it still dies on `SIGKILL`.
  - Proposal **[open]**: H gives the server stdout/stderr that H drains, or a private log file, never R's pipes.
- **SIGPIPE and EPIPE.** When R dies, writers to its pipes get `SIGPIPE`. Node ignores `SIGPIPE` and gets `EPIPE` instead. **[hypothesis]** An unhandled `EPIPE` on `process.stdout` may crash N or T. That is an uncontrolled exit path, and it makes output plumbing part of lifetime. H itself must ignore `SIGPIPE` and treat `EPIPE` on its report channel as runner loss.

### 6. Account separately for browser workers and the Next server

- **Next server (the target of this design).** It lives in G2 today, and in the proposed `GS`.
- **Test workers.** These stay in G1 and die with local-ci's `SIGKILL` to G1.
- **Browsers.** These run in their own groups G3, G4…, and **no current macOS mechanism owns them**.
  - On Linux, browsers inherit `WEBSITE_TRANSIENT_OWNER` through the environment, so the procfs scan covers them. **[hypothesis]** This depends on Playwright passing the runner's environment to the browser launch.
  - On macOS, browser cleanup after a worker is killed with `SIGKILL` depends on Chromium exiting on CDP pipe EOF. **[hypothesis]** This is tested by F9. If F9 fails, the browser leak is a separate blocker. The server supervisor doesn't solve it.
- **PID watcher.** As stated above, `watchRunner` has no identity check on macOS. It isn't counted as a cleanup mechanism there.

### 7. Helper crash or SIGKILL

Nothing guarantees cleanup if H is killed with `SIGKILL`, crashes, or is killed for running out of memory. **[fact]** A process can't run code after `SIGKILL`.

When H dies:

1. `LS` is reparented to `launchd` and reaped.
2. The pin is lost.
3. Nothing remains that may signal `GS` safely.

local-ci must therefore:

- Detect H's loss through control-pipe EOF, `EPIPE`, or H's own exit status, which local-ci reaps as H's parent.
- Report a cleanup failure.
- Stop the remaining shards.
- **Never** signal `GS` itself.

Mitigation (c) in requirement 3 is the only candidate that still works after H dies, and it is **[hypothesis]**. A cleanup guarantee that survives H being killed with `SIGKILL` is explicitly **not** claimed.

## Supervisor sketch (non-binding, gated on the fixtures)

1. **Start.** H is native C, starts under the placement chosen in requirement 3, resets `SIGCHLD`/`SIGPIPE`, and spawns the server with `POSIX_SPAWN_SETSID` (or `setsid` in a fork-exec shim) and `POSIX_SPAWN_CLOEXEC_DEFAULT`. It reports `READY {leader, pgid, sid}` for diagnostics only.
2. **Trigger.** A stop request or control EOF starts cleanup:
   1. `killpg(GS, SIGTERM)`.
   2. Wait, observing without reaping (F1), until the predicate in requirement 2 holds or the grace period ends.
   3. `killpg(GS, SIGKILL)`.
   4. Repeat the wait with the predicate.
   5. Reap `LS` exactly once.
   6. Report `{ok, survivors, escaped, signals}`.
3. **Fail closed.** No signal is sent after the reap. Every uncertainty yields `ok: false`.
4. **Node side.** Node awaits the report and probes the port only to classify a foreign listener. It removes the private state file only on `ok: true`. It never falls back to `ps` or a PID scan.

Unit tests for the Node protocol use a fake helper and never signal real processes.

## Native disposable fixture plan

Run these on a **disposable** macOS runner covering every supported macOS version and both architectures. Use only fixture processes started by the fixture, inside a fresh `mktemp -d` directory, on loopback ports reserved by the fixture.

- No live providers, host services, `launchd` units, settings changes, production gateway, or paid APIs.
- Each fixture records `getpid`/`getpgrp`/`getsid` to files and asserts that it signals only PIDs and groups it created.
- Each fixture has a hard timeout below 300 s.
- Record the macOS version, architecture, Xcode CLT version and SDK.

| ID | Proves or refutes | Method |
|---|---|---|
| F0 | SDK has `POSIX_SPAWN_SETSID`, `POSIX_SPAWN_CLOEXEC_DEFAULT`, `waitid`+`WNOWAIT`, `KERN_PROC_PGRP`/`KERN_PROC_SESSION`, `proc_listpgrppids` | Compile-only probe; no process spawned |
| F1 | Exit can be observed without reaping | Child exits; `waitid(WNOWAIT\|WNOHANG\|WEXITED)` and `EVFILT_PROC NOTE_EXIT`; then `KERN_PROC_PID` must still show `SZOMB`; final `waitpid` reaps |
| F2 | `WNOHANG` `waitpid` reaps (negative control) | Same as F1 with `waitpid(WNOHANG)`; the entry must be gone |
| F3 | Inherited `SIGCHLD=SIG_IGN` causes auto-reap; reset restores pinning | Parent sets `SIG_IGN`, execs fixture H with and without reset |
| F4 | Predicate behaviour | Group with zombie leader only, zombie + live grandchild, empty group: record `kill(-g,0)`, `KERN_PROC_PGRP`, session listing |
| F5 | Escape detection limits | Grandchild does `setpgid(0,0)` (same session), `setsid`, double-fork; record which enumeration still sees it and whether it can rejoin `GS` |
| F6 | CLOEXEC and EOF | Control pipe with and without `CLOEXEC_DEFAULT`; Node `spawn`/`fork` children; time until EOF after the writer is killed with `SIGKILL` |
| F7 | Blocked output, `SIGPIPE`, `EPIPE` | Native writer and Node writer to an unread pipe; kill the reader; observe block, `SIGPIPE`, and an unhandled `EPIPE` exit; TERM responsiveness while blocked |
| F8 | `killpg` success ≠ exit | Member that ignores TERM; `killpg` returns 0; the predicate must stay false until KILL |
| F9 | Real Playwright topology | Local fixture `webServer` (node script that spawns a grandchild and logs ids) plus one `about:blank` test using the bundled Chromium. Record G1/G2/browser groups and helper groups; send `SIGKILL` to the runner group as local-ci does; check what survives and whether Chromium exits on CDP EOF |
| F10 | Playwright shutdown vs. helper placement | Each candidate from requirement 3: does Playwright's `-G2` TERM/KILL reach H? How long does R's `close` wait for H? |
| F11 | `/bin/sh -c` exec behaviour | Record whether SH or T leads G2 |
| F12 | Supported-tree contract for Next | Run `next start` on a fixture build at a loopback port inside the temporary directory; record every descendant and any `setsid`/`setpgid` |
| F13 | Helper crash | Kill H with `SIGKILL` during each phase; confirm the server orphans, local-ci-style parent detects loss, and no further signal is sent |
| F14 | macOS `watchRunner` weakness | Confirm `processStartTime` is `null` and liveness is `kill(pid,0)` only (inspection plus a fixture with a non-recycled PID; do not attempt to force PID reuse) |

Linux CI cannot validate any macOS result. If F0–F8 don't establish requirements 1 and 2, macOS browser sharding stays fail-closed and deferred. Add no `ps` or PID-scan fallback.

## Dependency and build costs (unchanged, still unverified)

A C helper needs only libSystem. It does add:

- Native source.
- Platform-conditional build and packaging.
- Xcode Command Line Tools on the builder.

A Node-API addon isn't preferred, and a checked-in prebuilt binary isn't acceptable. Deployment target, code-signing/notarization, packaging and macOS CI availability are **[hypothesis]**.

## What this note does not claim

It does not claim that any supervisor design is safe or correct, that macOS supports the needed non-reaping wait, that the predicate is sound, that the browser and Next trees stay inside their groups, or that cleanup survives the helper dying. Each of these waits on the fixtures above.
