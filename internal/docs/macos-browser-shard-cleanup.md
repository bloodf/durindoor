# macOS browser-shard process cleanup design (#2661)

## Status and recommendation

This is a design note only. No process was started or signalled, and no product code changed. The Linux implementation is [`scripts/lib/website-shard-server.mjs`](../../scripts/lib/website-shard-server.mjs). It scans `/proc` for a same-uid process carrying a random inherited owner token, snapshots Linux start time, rechecks identity before signaling, and signals the process group only when the verified process is its leader. It fails closed when procfs is unavailable and removes a private state file only after cleanup.

Do not port its `/proc` algorithm or use `ps` output. On macOS, use a small native C supervisor as the owner of the complete shard-server lifetime. It creates a dedicated session/process group before `exec`, supervises the leader with `waitpid`, and is the only component allowed to signal that group. The Node runner communicates with the supervisor over inherited pipes and asks it to stop; EOF (runner death) also initiates cleanup. The helper must not discover targets by parsing arguments, environment, `ps`, or a system-wide PID scan. Keep the existing random owner token and private state file as correlation/diagnostic data, never as proof of process identity.

## Identity guarantees and boundaries

**Verified platform facts.** macOS provides POSIX `posix_spawn`/spawn attributes, `setsid`, `waitpid`, and `killpg`; Apple documents setting a process group during spawn and signaling a process group. `killpg` addresses the group as a unit and can fail with `ESRCH` or `EPERM`. See [Apple `posix_spawn` manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html), [spawn process-group attributes](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/posix_spawnattr_getpgroup.3.html), [setsid manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setsid.2.html), [killpg manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/killpg.2.html), and [waitpid manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/wait.2.html).

**Proposed guarantee.** The helper itself establishes the target's session/group at spawn, records the returned leader PID, and keeps the leader unreaped until group cleanup is complete. A retained waitable child prevents its PID from being recycled while the helper uses that PID as the group identifier. It signals only the group it created, first `SIGTERM`, waits a bounded grace period, then `SIGKILL`, and reaps the child. No unrelated process can be selected merely because it has matching text, environment, uid, or port. This avoids the scan-then-signal PID-reuse window for individual PIDs and the orphan-descendant blind spot of a direct-child-only cleanup.

**Residual boundaries.** POSIX process groups are not an immutable kernel ownership handle. A descendant can deliberately escape with `setsid`/`setpgid`; cleanup then cannot claim full-tree termination. The protocol should treat a still-listening shard port after the owned group is gone as a foreign/unattributed listener: never signal it, report cleanup failure (or explicit foreign-listener status consistent with current behavior), and stop subsequent shards. A same-uid malicious process that can access the private control pipe/state can interfere; this is protection against accidental leftovers, not a security boundary against the same user. If the supervisor itself is forcibly killed, an escaped or surviving descendant may remain; test and document this failure mode. Validate whether browser engines create escaped sessions before claiming descendant coverage.

## Implementation outline and cleanup behavior

1. Add a macOS-only helper source under `scripts/native/` and a build script. Start it as a child with a private control pipe; it spawns the configured transient server in a new session/group. Keep command construction fixed by the runner and pass an explicit argv/env vector; ownership never depends on either vector.
2. Have helper report `READY` with leader/group identifiers only for diagnostics. Node persists the current private state record (owner, port, helper PID, server leader PID, format version) with mode `0600`; the record is not sufficient authority to signal after helper loss.
3. On normal completion, timeout, watchdog, or interrupt, request shutdown. On runner EOF, helper starts the same shutdown path automatically. Send TERM once, wait a configurable bounded interval while checking/reaping child status, KILL the group if needed, then reap and report survivors/errors. Helper must handle repeated requests idempotently.
4. Node awaits the helper's structured completion result, probes the loopback port, removes a validated private state record only on established cleanup, and fails the shard/run on helper failure, escaped-process evidence, or an unexplained listener. Never fall back to a process-list scan or `ps -E`.
5. Linux retains its current procfs path. macOS uses the supervisor path. Other platforms remain fail-closed until separately designed.

## Testable acceptance strategy

Unit-test the Node protocol with a fake helper: startup failure, malformed/stale state, TERM/KILL result, helper crash, timeout, EOF, repeated cleanup, port still held, and cleanup result propagation. Keep injectable clocks and helper transport so unit tests never signal real processes.

On a disposable macOS CI host, compile the helper and run an isolated integration fixture with a harmless test child and grandchild that each write their own PID to a temporary file and hold a loopback socket. Verify normal exit, runner-pipe EOF, TERM-resistant child then KILL, orphaned same-group grandchild cleanup, already-exited leader, occupied foreign port left untouched, and bounded failure when a fixture deliberately escapes its session. Use only fixture PIDs/ports in a temporary directory; assert no unrelated fixture receives a signal. Repeat under the supported macOS versions and architectures. No production gateway or account data is involved.

## Dependency and build costs

A C helper has no third-party runtime dependency and can use macOS system headers/libSystem. It adds native source, platform-conditional build/package logic, and a macOS compiler toolchain requirement (Xcode Command Line Tools on the builder). A Node-API addon would avoid a subprocess protocol but adds node-gyp/compiler and ABI/build complexity; it is not preferred. A prebuilt checked-in binary is not appropriate. Build-time availability, minimum deployment target, code-signing/notarization constraints, and packaging the helper beside the scripts are **unverified hypotheses** for this repo and must be checked before implementation. Linux CI cannot validate macOS semantics; macOS CI becomes a required gate for this path.

## Validation plan before implementation

On a disposable supported macOS runner, inspect the installed SDK headers and man pages for `posix_spawnattr_setflags`, `POSIX_SPAWN_SETSID`/session support, `setsid`, `waitpid`, and signal semantics; compile a minimal non-signalling API probe, then a harmless isolated spawn/wait fixture. Confirm Node's actual `detached` behavior is not part of the ownership proof. Verify group membership and whether the selected browser/server child stack escapes the session. Record macOS version, architecture, Xcode CLT version, and test results. If the required APIs or cleanup invariant cannot be established, fail closed and defer macOS browser sharding rather than add a PID scan fallback.

## Evidence labels

The source inspection and linked Apple manual-page descriptions above are verified facts. The supervisor protocol, no-reuse argument while retaining an unreaped child, browser descendant behavior, build packaging, and CI availability are design claims or hypotheses until the macOS validation plan passes. This note does not claim the design has been implemented or validated on macOS.
