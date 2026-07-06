#!/usr/bin/env python3
"""
dinostack-daily-check.py

Companion to dinostack-daily-check.sh. Invoked when the upstream DinoStack
HEAD SHA differs from the SHA recorded in AGENTS.md §6.4.

What this script does:
  - Spins up a throwaway git worktree under /tmp (NOT the cron-running
    worktree, NOT the user's main checkout).
  - Inside the throwaway, creates a fresh branch off origin/dev.
  - Updates only AGENTS.md §6.4 to the new SHA.
  - Adds a dated "Drift history" entry to §6.4.
  - Commits, pushes, opens a PR against dev.
  - Cleans up the throwaway on every exit path (success, error, exception).

What this script does NOT do (these are the contract violations we
explicitly avoid, per AGENTS.md §6.4 and §7.4):
  - Does NOT mutate the cron-running worktree.
  - Does NOT mutate the user's main checkout.
  - Does NOT git pull the DinoStack repo.
  - Does NOT run the Hermes install.
  - Does NOT touch ~/.hermes/ or ~/.local/share/dinostack/.
  - Does NOT direct-push to dev — every change is a PR.

Required env / config:
  - gh CLI authenticated for the bloodf/durindoor fork
  - git push access to the bloodf/durindoor fork
  - python3 with stdlib only (no extra deps)
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

REPO_OWNER = "bloodf"
REPO_NAME = "durindoor"
UPSTREAM = "https://github.com/Space-Dinosaurs/DinoStack"
DSTACK_REPO_ROOT = Path.home() / ".local" / "share" / "dinostack"
HERMES_SKILL_LINK = Path.home() / ".hermes" / "skills" / "agentic-engineering" / "SKILL.md"


def run(cmd, cwd=None, check=True, capture=True):
    """Run a subprocess. Return CompletedProcess; raise on non-zero if check."""
    cp = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=False,
        capture_output=capture,
        text=True,
    )
    if check and cp.returncode != 0:
        sys.stderr.write(
            f"ERROR running {cmd!r} (rc={cp.returncode})\n"
            f"  stdout: {cp.stdout}\n"
            f"  stderr: {cp.stderr}\n"
        )
        raise SystemExit(cp.returncode)
    return cp


def log_line(log_file: Path, msg: str) -> None:
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"{ts}  {msg}"
    print(line)
    if log_file:
        with log_file.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


# Single source of truth for throwaway path safety. The throwaway
# directory is constructed in main(); if that construction ever changes,
# update these constants in lockstep.
THROWAWAY_PARENT = Path("/tmp")
THROWAWAY_BASENAME_PREFIX = "dinostack-bump-"


def _is_our_throwaway(path: Path) -> bool:
    """Conservative predicate: is `path` something we are willing to rmtree?

    True iff ALL of:
      - parent is exactly /tmp
      - basename starts with the exact prefix
      - path is a directory
      - AND one of:
        (a) contains a .git pointer (a real worktree)
        (b) is a registered git worktree
        (c) is empty (a stub from a prior crash)
        (d) contains only an AGENTS.md (a half-initialised throwaway
            that crashed before `git worktree add` finished)

    If any check fails, refuse. This is the only thing standing between
    a path-construction bug and `shutil.rmtree("/")`.
    """
    if path.parent.resolve() != THROWAWAY_PARENT:
        return False
    if not path.name.startswith(THROWAWAY_BASENAME_PREFIX):
        return False
    if not path.is_dir():
        return False
    if (path / ".git").exists():
        return True
    # Empty (or AGENTS.md-only) stub from a prior crash. This is the
    # common "stale leftover blocks the next worktree-add" case. Allow
    # empty dirs and dirs containing only an AGENTS.md (the only file
    # our throwaway creates before `git worktree add` finishes). Any
    # other non-empty dir without .git is refused — could be user data.
    try:
        contents = list(path.iterdir())
    except OSError:
        return False
    if not contents:
        return True
    if all(p.name == "AGENTS.md" for p in contents):
        return True
    try:
        cp = subprocess.run(
            ["git", "worktree", "list", "--porcelain", "--", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        return cp.returncode == 0 and str(path.resolve()) in cp.stdout
    except Exception:
        return False


def _safe_remove_stale_tmp_dir(throwaway: Path, log_file: Path) -> None:
    """Best-effort: remove a stale throwaway directory, guarded.

    Called after a failed worktree-remove and before a worktree-add, so
    a half-registered or crash-left throwaway from a prior run doesn't
    block the current run. Refuses to delete anything that doesn't pass
    the safety predicate.
    """
    if not throwaway.exists():
        return
    if not _is_our_throwaway(throwaway):
        log_line(
            log_file,
            f"warning: refusing to rmtree {throwaway} — fails safety predicate "
            f"(parent={throwaway.parent}, name={throwaway.name!r}). Manual cleanup required.",
        )
        return
    try:
        import shutil
        shutil.rmtree(str(throwaway))
    except Exception as e:
        log_line(log_file, f"warning: rmtree {throwaway} failed: {e!r}")


def _cleanup_throwaway(repo_root: Path, throwaway: Path, branch: str, log_file: Path) -> None:
    """Best-effort: remove the throwaway worktree and the local branch.

    Called on every exit path. Never raises. Logs a warning if removal
    fails so a future operator can clean up by hand.
    """
    try:
        run(
            ["git", "-C", str(repo_root), "worktree", "remove", "--force", str(throwaway)],
            check=False,
        )
    except Exception as e:
        log_line(
            log_file,
            f"warning: worktree remove failed ({e!r}); falling back to guarded rmtree",
        )
    # If worktree-remove didn't take the dir with it, finish the job with
    # the guarded rmtree.
    if throwaway.exists():
        _safe_remove_stale_tmp_dir(throwaway, log_file)
    try:
        run(
            ["git", "-C", str(repo_root), "branch", "-D", branch],
            check=False,
        )
    except Exception as e:
        log_line(
            log_file,
            f"warning: branch -D {branch} failed ({e!r}); manual cleanup: git branch -D {branch}",
        )


def fetch_first_100_lines_of_skill(observed_sha: str) -> str:
    """Fetch the first ~100 lines of DinoStack's new SKILL.md so a reviewer
    can eyeball whether the methodology changed. This is a *check*, not an
    install.
    """
    url = f"https://raw.githubusercontent.com/Space-Dinosaurs/DinoStack/{observed_sha}/.hermes/SKILL.md"
    try:
        cp = run(["curl", "-fsSL", "--max-time", "20", url], check=False)
        if cp.returncode != 0:
            return f"(could not fetch {url}: {cp.stderr.strip()[:200]})"
        lines = cp.stdout.splitlines()[:100]
        snippet = "\n".join(lines)
        if len(snippet) > 4000:
            snippet = snippet[:4000] + "\n... (truncated; full file at the URL above)"
        return snippet
    except Exception as e:
        return f"(error fetching snippet: {e!r})"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--recorded", required=True, help="SHA recorded in AGENTS.md §6.4")
    p.add_argument("--observed", required=True, help="Current DinoStack main HEAD SHA")
    p.add_argument("--agents-md", required=True, type=Path,
                   help="Path to AGENTS.md in the cron-running worktree (used for parsing only; not edited)")
    p.add_argument("--repo-root", required=True, type=Path,
                   help="Path to the durindoor repo on this machine (used as the worktree-add source)")
    p.add_argument("--log-file", type=Path, default=None)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Run every step up to (but not including) `git push` and `gh pr create`. "
            "Useful for verifying the throwaway-worktree / AGENTS.md / commit-message "
            "pipeline end-to-end without leaving anything on the remote. The throwaway "
            "worktree is still cleaned up on every exit path."
        ),
    )
    args = p.parse_args()

    log_line(
        args.log_file,
        f"drift-check.py: starting for recorded={args.recorded} observed={args.observed}"
        f"{'  [DRY-RUN: no push, no PR]' if args.dry_run else ''}",
    )

    # Safety check: do NOT mutate the cron-running worktree OR the user's
    # main checkout OR the live install. We work in a throwaway worktree
    # under /tmp; everything is cleaned up on every exit path.
    if not args.repo_root.is_dir():
        log_line(args.log_file, f"error: repo-root {args.repo_root} is not a directory")
        return 1

    today = datetime.date.today().isoformat()
    # Include the observed short SHA in the branch name so two upstream
    # drifts on the same day produce distinct branches (rare but possible
    # via force-push, mirror reset, etc.).
    branch = f"cron/dinostack-sha-bump-{today}-{args.observed[:12]}"
    throwaway = Path("/tmp") / f"dinostack-bump-{today}-{args.observed[:12]}"
    throwaway_agents: Path | None = None
    rc = 1
    try:
        # 1. fetch origin/dev so the throwaway has a fresh base
        log_line(args.log_file, "fetching origin/dev")
        run(["git", "-C", str(args.repo_root), "fetch", "origin", "dev"], check=False)

        # 2. spin up an isolated, throwaway worktree under /tmp. This is the
        #    safe place to do PR work from a cron: the cron-running worktree
        #    is never branch-switched, the AGENTS.md in the user's working
        #    copy is never mutated, and on cleanup the throwaway is removed.
        log_line(args.log_file, f"creating throwaway worktree at {throwaway} on branch {branch}")
        # Best-effort cleanup of a prior failed run. We try the git-aware
        # path first; if it leaves the dir behind, the guarded rmtree takes
        # care of it. This is the only thing that keeps a crash in the
        # middle of a prior run from blocking the next one.
        run(
            ["git", "-C", str(args.repo_root), "worktree", "remove", "--force", str(throwaway)],
            check=False,
        )
        if throwaway.exists():
            _safe_remove_stale_tmp_dir(throwaway, args.log_file)
        run(["git", "-C", str(args.repo_root), "branch", "-D", branch], check=False)
        run(
            [
                "git", "-C", str(args.repo_root), "worktree", "add",
                "-b", branch, str(throwaway), "origin/dev",
            ],
            check=True,
        )

        # 3. update §6.4 in the THROWAWAY AGENTS.md (NOT args.agents_md, NOT
        #    the cron-running worktree, NOT the user's main checkout).
        throwaway_agents = throwaway / "AGENTS.md"
        if not throwaway_agents.is_file():
            log_line(
                args.log_file,
                f"error: AGENTS.md not found in throwaway worktree at {throwaway_agents}",
            )
            return 1

        agents = throwaway_agents.read_text(encoding="utf-8")
        new_line = f"**Last verified:** `{args.observed}`"
        new_agents, n = re.subn(
            r"\*\*Last verified:\*\* `[0-9a-f]{40}`",
            new_line,
            agents,
            count=1,
        )
        if n != 1:
            log_line(
                args.log_file,
                "error: could not find 'Last verified' line in throwaway AGENTS.md",
            )
            return 1
        throwaway_agents.write_text(new_agents, encoding="utf-8")

        # 4. add a Drift history section under §6.4 if not already present
        drift_entry = (
            f"\n- {today}: drift detected by cron. Recorded `{args.recorded[:12]}…`, "
            f"observed `{args.observed[:12]}…`. PR opened; awaiting review.\n"
        )
        if "### Drift history" not in new_agents:
            new_agents = new_agents.replace(
                new_line,
                new_line + "\n\n### Drift history\n",
                1,
            )
        new_agents = new_agents.replace(
            "### Drift history\n",
            "### Drift history\n" + drift_entry,
            1,
        )
        throwaway_agents.write_text(new_agents, encoding="utf-8")

        # 5. fetch a snippet of the new SKILL.md for the PR body
        log_line(args.log_file, "fetching first 100 lines of upstream SKILL.md for review")
        skill_snippet = fetch_first_100_lines_of_skill(args.observed)

        # 6. commit (and push, unless --dry-run). The commit happens INSIDE
        #    the throwaway; args.repo_root is never touched.
        log_line(args.log_file, "committing from throwaway worktree")
        run(["git", "-C", str(throwaway), "add", "AGENTS.md"], check=True)
        msg = (
            f"docs(harness): record DinoStack SHA bump {args.recorded[:12]} -> {args.observed[:12]}\n\n"
            f"Detected by the daily cron (scripts/dinostack-daily-check.sh).\n"
            f"Recorded in §6.4. Drift history entry added.\n\n"
            f"This PR is the *check*; the install on the live machine is unchanged.\n"
            f"After this merges, a follow-up install run (manual or otherwise) will\n"
            f"update the symlink at ~/.hermes/skills/agentic-engineering/SKILL.md to\n"
            f"point at the new SHA."
        )
        run(
            [
                "git", "-C", str(throwaway), "-c",
                "user.name=durindoor-bot", "-c",
                "user.email=durindoor-bot@users.noreply.github.com",
                "commit", "-m", msg,
            ],
            check=True,
        )

        if args.dry_run:
            log_line(
                args.log_file,
                "dry-run: skipping `git push` and `gh pr create`. The throwaway worktree "
                "is cleaned up after this; the diff can be re-derived by re-running with "
                "--dry-run.",
            )
            log_line(
                args.log_file,
                f"dry-run: would have pushed branch {branch} and opened PR against dev",
            )
            log_line(args.log_file, "drift-check.py: done (dry-run)")
            rc = 0
            return rc

        log_line(args.log_file, "pushing branch to origin")
        run(["git", "-C", str(throwaway), "push", "-u", "origin", branch], check=True)

        # 7. open the PR via gh
        log_line(args.log_file, "opening PR via gh CLI")
        pr_body = (
            f"## DinoStack upstream SHA drift detected\n\n"
            f"Detected by `scripts/dinostack-daily-check.sh` (cron entrypoint, see AGENTS.md §6.6).\n\n"
            f"- Recorded in AGENTS.md §6.4: `{args.recorded}`\n"
            f"- Current `main` HEAD: `{args.observed}`\n"
            f"- Detected on: {today}\n\n"
            f"### What this PR does\n\n"
            f"- Updates only `AGENTS.md §6.4` to the new SHA.\n"
            f"- Adds a `### Drift history` subsection under §6.4 with this event.\n"
            f"- Does **not** git-pull the DinoStack repo.\n"
            f"- Does **not** re-run `bash .hermes/install.sh`.\n"
            f"- Does **not** touch `~/.hermes/` or `~/.local/share/dinostack/`.\n\n"
            f"### What you do after merging\n\n"
            f"1. On the Hermes host, run:\n"
            f"   ```bash\n"
            f"   git -C ~/.local/share/dinostack fetch origin\n"
            f"   git -C ~/.local/share/dinostack checkout {args.observed}\n"
            f"   bash ~/.local/share/dinostack/.hermes/install.sh --mode=opt-in --profile=default\n"
            f"   ```\n"
            f"2. Verify the symlink target: `readlink -f ~/.hermes/skills/agentic-engineering/SKILL.md`\n"
            f"   should now end in `{args.observed}/.hermes/SKILL.md`.\n\n"
            f"### Snippet of the new upstream SKILL.md (first 100 lines)\n\n"
            f"```\n{skill_snippet}\n```\n\n"
            f"### Dependency\n\n"
            f"Depends on #67 (the §6.2 install-recipe fix). #67 should merge first so this\n"
            f"PR's `AGENTS.md` diff is the *only* change to §6 in this PR cycle."
        )
        cp = run(
            [
                "gh", "pr", "create",
                "--repo", f"{REPO_OWNER}/{REPO_NAME}",
                "--base", "dev",
                "--head", branch,
                "--title",
                f"docs(harness): record DinoStack SHA bump {args.recorded[:12]} -> {args.observed[:12]}",
                "--body", pr_body,
                "--label", "cron,dinostack,harness",
            ],
            check=False,
        )
        if cp.returncode != 0:
            log_line(
                args.log_file,
                f"error: gh pr create failed: {cp.stderr.strip()[:300]}",
            )
            # Best-effort: clean up the just-pushed remote branch so we don't
            # leak a remote-only ref with no PR. The throwaway worktree will
            # be removed in the finally block.
            try:
                run(["git", "-C", str(throwaway), "push", "origin", "--delete", branch], check=False)
                log_line(args.log_file, f"cleaned up remote branch {branch} after PR-create failure")
            except Exception as e:
                log_line(
                    args.log_file,
                    f"warning: remote branch cleanup failed ({e!r}); manual cleanup: git push origin --delete {branch}",
                )
            return 1

        pr_url = cp.stdout.strip()
        log_line(args.log_file, f"opened PR: {pr_url}")
        log_line(args.log_file, "drift-check.py: done")
        rc = 0
        return rc
    except SystemExit as e:
        log_line(args.log_file, f"error: subprocess aborted with code {e.code}")
        return 1
    except Exception:
        log_line(args.log_file, "error: unhandled exception")
        log_line(args.log_file, traceback.format_exc())
        return 1
    finally:
        # Always clean up the throwaway. This block runs on every exit path.
        _cleanup_throwaway(args.repo_root, throwaway, branch, args.log_file)


if __name__ == "__main__":
    sys.exit(main())
