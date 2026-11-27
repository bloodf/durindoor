# macOS browser-shard process cleanup design (#2661)

## Status

**Open design. Not safe for implementation.** An independent safety review of the first draft (bcc6d30616) found that its "proposed guarantee" was not established. That draft reaped the identity-pinning child too early. It also used a circular completion test, ignored the real Playwright topology and treated a free port as proof of cleanup. This revision replaces that guarantee with explicit open questions, then gives the disposable fixtures that must pass before any guarantee is claimed.

A second independent review (of ddeef28035) found five further errors, corrected here:

1. The draft allowed a blocking `waitpid` after a bounded failure, while the leader could still be alive. H now reaps only after it has observed the leader's exit; otherwise it reports failure and sends nothing more (requirement 1).
2. The draft offered `proc_listpgrppids` as a session-wide enumeration. It covers one process group. Session evidence is now described as conditional on no escape, never as proof of a full tree (requirement 2).
3. The draft let a helper call `setsid()` after Playwright's shell started it. If the shell `exec`s the helper, the helper leads its group and `setsid()` fails. That placement now needs an explicitly designed fork/exec arrangement, or it is rejected (requirement 3).
4. The draft let a port probe "classify a foreign listener". A probe identifies only an unattributed listener, which is never signalled and always makes cleanup fail (requirement 4 and the sketch).
5. The draft said helper death immediately reaps the leader and that local-ci is always the helper's parent. Neither holds in general (requirement 7).

A third independent review found that F15 could not reach the path it targeted: blocking `SIGTERM` and stopping the leader do not resist H's later `SIGKILL`. F15 now injects the signal and exit-observer transport, next to a native positive control.

This document is still a design under review. Nothing in it is approved for implementation.

No process was started or signalled for this revision. No product code, setting, or service changed. The evidence comes from reading this repository, the installed Playwright 1.63.0 and Next 16.4.5 sources under `website/node_modules/.pnpm/`, and public manual pages. Every statement is labelled:

- **[fact: code]** comes from reading source in this checkout, with its location.
- **[fact: doc]** comes from a platform manual or Node documentation. It must still be confirmed on the target macOS SDK.
- **[hypothesis]** is unproven. A fixture in [the fixture plan](#native-disposable-fixture-plan) must test it. A fixture can refute it or fail to refute it.
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
4. On Linux only, local-ci's token-and-procfs cleanup. Since #2684 it classifies each PID as exited, foreign, owned or uncertain, fails on uncertain or unattributed state and signals only owned PIDs ([local-ci](local-ci.md)). That classification depends on `/proc/<pid>/environ`, `status` uids and clock-tick start times, none of which stock macOS exposes, so it does not carry over: macOS cleanup stays fail-closed until this design is approved.

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

**Reaping rule.** A blocking `waitpid(LS, …, 0)` waits until `LS` exits. **[fact: doc]** A signal call that returns success is not an observed exit, and it sets no time limit on that exit. `SIGKILL` cannot be caught, blocked or ignored, and it also terminates a stopped process (**[fact: doc]**), so neither a blocked `SIGTERM` nor `SIGSTOP` protects `LS` from it. H still must not assume that `LS` has exited, or will exit before the deadline. So:

- H calls `waitpid` on `LS` **only after** the non-reaping observer (F1) has reported that `LS` has exited. **[hypothesis]** The call then returns at once, because the zombie is already there. Fixture F15 checks this.
- If the deadline passes and H has **not** observed `LS` exit, H must not call `waitpid` in any form that can block. `LS` may still be alive. H reports a bounded failure with what it enumerated, sends **no further signal** to `GS` or `LS`, and leaves `LS` unreaped.
- When H then exits, `LS` is reparented and H's pin ends. That is acceptable only because H has already committed to sending nothing more. No other component inherits authority to signal `GS` (see requirement 7).
- After H has observed `LS` exit and before it reaps, it may still signal `GS`, because the zombie keeps the ID pinned. After the reap it signals nothing.

### 2. Non-circular completion predicate for grandchildren

`killpg` returning 0 only means the signal was queued for at least one member. It does not prove that any process exited. **[fact: doc]** `kill(-GS, 0)` can't be the completion test either: the zombie leader that keeps the pin may itself make the group look non-empty. The test would then never pass, or it would pass only because the pin was released. **[hypothesis]** That behaviour is unverified on macOS.

**Proposed predicate [hypothesis, to be tested by F4/F5].** This is a group predicate for `GS`, plus a session predicate only if an exhaustive session enumeration is verified. It is not a verdict on the descendant tree. It is satisfied only when every condition below that applies holds in one pass:

- `sysctl {CTL_KERN, KERN_PROC, KERN_PROC_PGRP, GS}` succeeds without truncation. It returns exactly one `kinfo_proc`, whose PID is `LS` and whose `p_stat` is `SZOMB`.
- A session-scoped enumeration of `LS`'s session returns the same single zombie. This would catch members that moved to a different group but stayed in the session. Such a member could later `setpgid` back into `GS`.
  - The only candidate named so far is `sysctl` `KERN_PROC_SESSION`. **[hypothesis]** Whether macOS implements it, what its argument means, whether it is exhaustive, and whether it lists zombies are all unverified (F0, F4, F16).
  - `proc_listpgrppids` is **not** a session enumeration. Its `libproc.h` declaration takes one process-group ID and lists that group's members (**[fact: doc]**, to be confirmed in the SDK by F0). It can serve at most as a second reading of `GS`, next to `KERN_PROC_PGRP`. It cannot find a member that moved to another group.
  - **[open]** If no exhaustive session enumeration is verified, this session condition cannot be evaluated and the predicate has group evidence only. A member that moved to another group in the same session is then undetected, and the design must either find another independent and exhaustive discovery mechanism or record that gap as a residual that blocks any session-level claim.
- `LS` is still unreaped, as confirmed by F1's non-reaping observer.

**What a passing predicate means.** Even with a verified session enumeration, a pass shows only that no **visible** member of `GS` or of the session is left. A process that called `setsid` has left the session and is invisible to both checks. **[fact: doc]** A pass is therefore conditional on no such escape. It is not proof that the whole descendant tree is gone (see requirement 4).

**Fail closed.** Any of the following counts as **not complete**: a sysctl error, a size race, an unknown `p_stat`, an entry from a different uid, or a mismatch between enumerations. After the bounded deadline, H reports failure with the enumerated survivors and sends no further signal. It reaps `LS` only if it has observed `LS` exit; otherwise it leaves `LS` unreaped (requirement 1). Whether a zombie leader appears in `KERN_PROC_PGRP` and `KERN_PROC_SESSION` results is **[hypothesis]**.

### 3. Place the helper outside every group another component force-kills

**[fact: code]** If H is started as the Playwright `webServer` command, it lands in G2. Playwright then sends `SIGKILL` to H on shutdown timeout or on normal exit. H must not be in G1 (local-ci's `SIGKILL` target) or in G2.

Candidate placements, all **[open]**:

- **(a) H leaves G2 after Playwright starts it**, then spawns the server in another new session. **As first drafted, this placement does not work.**
  - Node's `detached: true` makes SH the leader of a new session and group. If `/bin/sh -c` `exec`s H (F11 decides this), H inherits SH's PID and is already a group leader and session leader. `setsid()` fails with `EPERM` for a process-group leader. **[fact: doc]** H cannot leave G2 by calling `setsid()` itself.
  - If SH does not `exec`, H is a non-leader in G2 and `setsid()` would succeed. The design must not depend on that, because shell `exec` behaviour is unverified and may differ between macOS releases.
  - Candidate (a) therefore needs an **explicitly designed fork/exec arrangement**. For example, the process Playwright starts forks, and only the child calls `setsid()`. That arrangement must specify which process Playwright sees, which process holds R's pipes, and what happens to each when Playwright sends `SIGKILL` to `-G2`. If no such arrangement is specified and passes F10 and F19, candidate (a) is rejected.
  - **[open] Teardown notification is unresolved.** Once H is outside G2, Playwright's `-G2` signals no longer reach H. Nothing yet tells H that Playwright wants the server stopped. A pipe from the in-group process could carry EOF on its death, but that depends on descriptor inheritance (requirement 5) and is unverified (F20).
  - Whatever process holds R's stdio pipes delays R's `close`. R's teardown is then bounded only by H's deadline, which must stay below local-ci's budget.
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

**What a port probe may do.** A successful connect shows only that **something** listens on the port. It does not show which process, which group, or whether it belongs to this shard. Such a listener is **unattributed**. Rules:

- An unattributed listener is **never** signalled, and the probe result is never used to choose a PID or group to signal.
- An unattributed listener after cleanup makes cleanup **fail** (`ok: false`). It may be an escaped server descendant (F17) or an unrelated process; the probe cannot tell them apart.
- A free port does not make cleanup succeed. It only removes one reason to fail (F18).

**[fact: doc]** POSIX groups and sessions are not containment. Any descendant can leave with `setsid`. macOS offers no unprivileged kernel handle that tracks a whole process tree. `NOTE_TRACK` is documented as unsupported, and Endpoint Security needs an entitlement. **[hypothesis]** Enumerating children recursively with `proc_listchildpids` is racy and loses the link when a process reparents to `launchd`.

**Bounded supported-process contract [open, proposal].** No full-tree cleanup is claimed today. Any future claim would be limited to a declared supported tree: SH or T, then T, then Next `start`. That tree must:

- Make no `setsid`/`setpgid` call. Fixture F12 records this.
- Keep every process in `GS` and `SS`.

Anything that escapes the session is outside the guarantee. H checks this best-effort at checkpoints (enumerating descendants with the same uid by parent links before signalling) and fails closed if it finds a violation. An escape it never sees remains a documented residual. No full-tree claim stands without either this contract or a stronger mechanism.

**Fixtures observe; they do not prove.** F12 and the other fixtures run a finite number of times on specific inputs. A run in which no escape occurs shows that none occurred in that run. It does not prove that the supported tree never escapes, for example under other Next features, load, or future versions. The contract is an assumption that the fixtures fail to refute, not a proven property.

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

1. **Retention authority is lost at once.** H was the only process allowed to signal `GS`, and only because it held `LS` unreaped. No other process inherits that authority, and nothing remains that may signal `GS` safely.
2. `LS` is reparented to `launchd`. It is **not necessarily reaped at once**: a live `LS` stays alive, possibly indefinitely, and an exited `LS` is reaped whenever `launchd` collects it. **[hypothesis]** The timing is unverified (F13). From this point the group ID may be reused after the reap, so even a correct-looking `GS` value must not be signalled.

local-ci must therefore:

- Detect H's loss and report a cleanup failure.
  - Control-pipe EOF or `EPIPE` works under any placement that gives local-ci such a pipe. **[hypothesis]** It depends on descriptor inheritance (requirement 5, F6, F20).
  - H's exit status is available to local-ci **only if local-ci is H's parent**. That holds under placement (b), where local-ci spawns H. Under (a) and (c), H's parent is in Playwright's tree, so local-ci sees no exit status and must rely on the control channel.
- Stop the remaining shards.
- **Never** signal `GS` itself.

Mitigation (c) in requirement 3 is the only candidate that still works after H dies, and it is **[hypothesis]**. A cleanup guarantee that survives H being killed with `SIGKILL` is explicitly **not** claimed.

## Supervisor sketch (non-binding, gated on the fixtures)

1. **Start.** H is native C, starts under the placement chosen in requirement 3, resets `SIGCHLD`/`SIGPIPE`, and spawns the server with `POSIX_SPAWN_SETSID` (or `setsid` in a fork-exec shim) and `POSIX_SPAWN_CLOEXEC_DEFAULT`. It reports `READY {leader, pgid, sid}` for diagnostics only.
2. **Trigger.** A stop request or control EOF starts cleanup. How a stop request reaches H under each placement is still **[open]** (requirement 3).
   1. `killpg(GS, SIGTERM)`.
   2. Wait, observing without reaping (F1), until the predicate in requirement 2 holds or the grace period ends.
   3. `killpg(GS, SIGKILL)`.
   4. Repeat the wait with the predicate, up to a hard deadline.
   5. If H has observed `LS` exit, reap `LS` exactly once. If it has not, do **not** call `waitpid`; leave `LS` unreaped and mark the result failed.
   6. Report `{ok, leaderExitObserved, survivors, escaped, signals}`.
3. **Fail closed.** No signal is sent after the reap, or after H has decided on failure. Every uncertainty yields `ok: false`.
4. **Node side.** Node awaits the report, then runs its own loopback port check.
   - A listener found by that check is **unattributed**. Node never signals it and never derives a PID or group from it. It forces the overall result to failure.
   - Node removes the private state file only when the helper reported `ok: true` **and** its own port check found no listener. Until that check finishes, the state file stays. Any failure keeps the state file for diagnosis.
   - It never falls back to `ps` or a PID scan.

Unit tests for the Node protocol use a fake helper and never signal real processes.

## Native disposable fixture plan

Run these on a **disposable** macOS runner covering every supported macOS version and both architectures. Use only fixture processes started by the fixture, inside a fresh `mktemp -d` directory, on loopback ports reserved by the fixture.

- No live providers, host services, `launchd` units, settings changes, production gateway, or paid APIs.
- Each fixture records `getpid`/`getpgrp`/`getsid` to files and asserts that it signals only PIDs and groups it created.
- Each fixture has a hard timeout below 300 s.
- Record the macOS version, architecture, Xcode CLT version and SDK.

| ID | Observation or failure condition | Method |
|---|---|---|
| F0 | SDK has `POSIX_SPAWN_SETSID`, `POSIX_SPAWN_CLOEXEC_DEFAULT`, `waitid`+`WNOWAIT`, `KERN_PROC_PGRP`/`KERN_PROC_SESSION`; record the `proc_listpgrppids` prototype (one group ID argument) | Compile-only probe; no process spawned |
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
| F13 | Helper crash | Kill H with `SIGKILL` during each phase. Record when `LS` is reparented and when (or whether) it is reaped; it may stay alive. Confirm loss is detected through the control channel, and through exit status only under placement (b); confirm no further signal is sent to `GS` |
| F14 | macOS `watchRunner` weakness | Confirm `processStartTime` is `null` and liveness is `kill(pid,0)` only (inspection plus a fixture with a non-recycled PID; do not attempt to force PID reuse) |
| F15 | Bounded failure when exit is not observed. The injected run fails if H misses its deadline or bound, reports anything but `ok: false, leaderExitObserved: false`, requests a signal after deciding on failure, or calls `waitpid`. The control fails if the observer does not fire, or the following `waitpid` does not return at once | Injected run and native positive control, described [below the table](#f15-method) |
| F16 | Moved groups | Member calls `setpgid` into a new group in the same session, then optionally back into `GS`. Record what `KERN_PROC_PGRP`, `proc_listpgrppids(GS)` and `KERN_PROC_SESSION` each show. Expected: the group listings miss it; the predicate must fail if the session listing sees it, and the gap is recorded if no exhaustive session listing exists |
| F17 | Escaped listener | Server descendant calls `setsid` and binds the reserved loopback port, then the group is cleaned. The helper predicate may pass; the Node port check must find an unattributed listener, report failure, keep the state file, and send no signal. The fixture itself stops the escaped process afterwards by the PID it recorded at creation |
| F18 | No listener | (1) Server never listens; (2) server closes its listener but stays alive. Port is free in both; the predicate must stay false while the member lives, so a free port never yields success alone |
| F19 | Placement (a) fork/exec | Start a fixture helper through `spawn(…, {shell: true, detached: true})`. Record whether it leads its group, that `setsid()` returns `EPERM` when it does, and the behaviour of the specified fork/exec arrangement under Playwright-style `SIGKILL` to the group |
| F20 | Pipe behaviour across helper and placements | For each placement: control and report pipes between local-ci, the in-group process and H. Kill each holder with `SIGKILL`; record EOF timing, `EPIPE` on the next write, `SIGPIPE` disposition, and any leaked write end that delays EOF |

#### F15 method

A real leader cannot be relied on to force this path. Blocking `SIGTERM` or stopping the leader with `SIGSTOP` does not resist H's later `SIGKILL` (requirement 1).

- **Injected run (deterministic).** H's signal send, exit observer, enumeration and `waitpid` go through a fixture-only seam. The signal transport records each requested signal, returns success and delivers nothing. The exit observer never reports exit. The enumeration keeps reporting a live leader. The `waitpid` stub records any call and returns at once. The leader's identity is a placeholder, so this run spawns no leader and calls no real `killpg` or `kill`. It expects `SIGTERM`, then `SIGKILL`, then a bounded failure with no later request.
- **Native positive control.** H uses the real transport, observer and `waitpid` on a disposable fixture leader that exits by itself. The observer must report the exit before H calls `waitpid`, and that call must return at once.

The injected run observes only how H reacts to the transport's answers. It is not evidence that macOS delays or withholds an exit after `SIGKILL`, or that the native observer is reliable. **[open]** The design must show that a production build cannot select the injected transport.

**Scope of fixture results.** Each fixture observes behaviour in a finite number of runs on specific macOS versions. A pass shows what happened in those runs. It does not prove that no process can ever escape the group or session, and it does not prove the behaviour on untested releases.

Linux CI cannot validate any macOS result. If F0–F8 don't establish requirements 1 and 2, macOS browser sharding stays fail-closed and deferred. Add no `ps` or PID-scan fallback.

## Dependency and build costs (unchanged, still unverified)

A C helper needs only libSystem. It does add:

- Native source.
- Platform-conditional build and packaging.
- Xcode Command Line Tools on the builder.

A Node-API addon isn't preferred, and a checked-in prebuilt binary isn't acceptable. Deployment target, code-signing/notarization, packaging and macOS CI availability are **[hypothesis]**.

## What this note does not claim

It does not claim that any supervisor design is safe or correct, or that any part of it is approved for implementation. It does not claim that macOS supports the needed non-reaping wait, that the predicate is sound, that an exhaustive session enumeration exists, that the browser and Next trees stay inside their groups, that any helper placement delivers teardown notification, or that cleanup survives the helper dying. Fixtures can refute these claims or fail to refute them; they cannot prove universal no-escape.
