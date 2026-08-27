# Data Management

DurinDoor stores all persistent state in `DATA_DIR`. This page covers backup, restore, container volume handling, and uninstallation.

## DATA_DIR layout

```
DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # automatic pre-upgrade backups
├── auth/                 # OAuth tokens, cookies
├── logs/                 # runtime logs
├── mitm/                 # MITM certificates and state (if configured)
└── runtime/              # runtime configs
```

Always stop DurinDoor before backing up or restoring so the SQLite database is not mid-write.

The pure-JavaScript `sql.js` fallback publishes each full database image through
an owner-only sibling file, flushes it to storage, then atomically renames it
over `data.sqlite`. If staging or publication fails, the previous database stays
intact and the temporary file is removed. This protects ordinary runtime saves;
operators should still stop DurinDoor before backups and restores.

```bash
# CLI / source
Ctrl+C

# Docker
docker stop durindoor
```

## Backing up a host directory

Stop DurinDoor first, then copy the directory:

```bash
docker stop durindoor
BACKUP="$DATA_DIR.backup-$(date +%Y%m%d%H%M%S)"
cp -a -- "$DATA_DIR" "$BACKUP"
```

The `--` stops option parsing so paths starting with `-` are safe. The `-a` flag preserves permissions and dotfiles.

**Guard:** `$DATA_DIR` must be an existing, absolute path. Verify it is not `/` or an empty value before running. Store the backup on a different disk or machine. Backups on the same volume are vulnerable to simultaneous disk failure.

Restart DurinDoor when the copy is complete.
## Restoring a host directory

```bash
docker stop durindoor   # if running in Docker
BACKUP="$DATA_DIR.backup-YYYYMMDD"
TARGET="$DATA_DIR"

# Guard against destructive mistakes
if [ -z "$TARGET" ] || [ "$TARGET" = "/" ] || [ ! -d "$TARGET" ]; then
  echo "ERROR: TARGET must be a non-root existing directory." >&2; exit 1
fi

# Timestamp the current directory before replacing it
mv -- "$TARGET" "$TARGET.pre-restore-$(date +%Y%m%d%H%M%S)"
cp -a -- "$BACKUP" "$TARGET"
```

The `--` stops option parsing. The timestamped move preserves the current state before overwrite. Back up the current `DATA_DIR` first if it contains unrecoverable data.

To test a restore to a new location before touching the real one:

```bash
cp -a -- "$DATA_DIR.backup-YYYYMMDD" /tmp/durindoor-test-restore
DATA_DIR=/tmp/durindoor-test-restore durindoor
```

Verify providers, API keys, combos, and usage in the dashboard before using the restored copy in production.
## Backing up a Docker named volume

A Docker named volume has no host path, so it must be backed up from a container that mounts it. Stop DurinDoor first, then archive the `durindoor-data` volume:

```bash
docker stop durindoor
docker run --rm \
  -v durindoor-data:/data \
  -v "$PWD:/backup" \
  alpine tar czf /backup/durindoor-data-backup-$(date +%Y%m%d).tar.gz -C /data .
```

## Restoring a Docker named volume

Stop DurinDoor first. This restores the named volume from a backup archive:

```bash
ARCHIVE="$PWD/durindoor-data-backup-YYYYMMDD.tar.gz"

# Validate archive exists and is a readable tar file
if [ ! -f "$ARCHIVE" ]; then echo "Backup archive not found: $ARCHIVE"; exit 1; fi
if ! docker run --rm -v "$PWD:/backup" alpine tar tzf "/backup/$(basename "$ARCHIVE")" >/dev/null 2>&1; then
  echo "ERROR: Archive is not a valid tar file: $ARCHIVE"; exit 1
fi

# Back up the current volume
docker stop durindoor
docker run --rm \
  -v durindoor-data:/data \
  -v "$PWD:/backup" \
  alpine tar czf /backup/durindoor-data-pre-restore-$(date +%Y%m%d%H%M%S).tar.gz -C /data .

# Remove any container that references the volume — a running container blocks docker volume rm
docker rm -f durindoor

# Remove and recreate the volume clean, then extract the backup
docker volume rm durindoor-data
docker volume create durindoor-data
docker run --rm \
  -v durindoor-data:/data \
  -v "$PWD:/backup" \
  alpine tar xzf "/backup/$(basename "$ARCHIVE")" -C /data
```

This removes and recreates the volume so the restore starts from a clean target — stale files from a previous restore cannot survive this procedure. Always validate the archive with `tar tzf` before proceeding.
## Copy a named volume to a host path

If you stop using Docker, copy the volume contents to a host path before removing the volume:

```bash
docker run --rm \
  -v durindoor-data:/data \
  -v "$HOME/.durindoor:/host" \
  alpine cp -a /data/. /host/
```

## Startup integrity check

DurinDoor runs SQLite `PRAGMA quick_check` after schema migration and before
the database is accepted for use. Startup stops on corruption reported by
that check; it is a fast structural check, not a substitute for
`PRAGMA integrity_check` or `PRAGMA foreign_key_check`. DurinDoor does not
attempt automatic repair or overwrite the database.

If startup reports `SQLite integrity check failed`, stop all writers and
preserve the database together with its `-wal` and `-shm` sidecars before
recovery. Restore only a backup whose integrity and required tables you have
verified. Migration safety backups made with the lightweight backup path omit
the non-critical, auto-pruned `requestDetails` observability log. Any manual
`REINDEX`, `VACUUM`, or data salvage must operate on a copy and pass
`PRAGMA integrity_check` before it replaces the active database.

## 9router data directory

`~/.9router` (macOS/Linux) and `%APPDATA%\\9router` (Windows) are the default `DATA_DIR` paths when no override is set. They are not separate or legacy backup locations — they are the active runtime default, retained for migration compatibility. Anything under those paths is part of `DATA_DIR` and must be backed up, protected, and deleted according to the same rules as any `DATA_DIR`.

**Never delete `~/.9router` or any `~/.9router/backups` directory without explicit operator confirmation.** These directories may contain active data or irreplaceable backups.

## Uninstalling

### Docker

```bash
docker stop durindoor && docker rm durindoor
# Remove the named volume (irreversible — back up first)
docker volume rm durindoor-data
# Remove the image
docker rmi ghcr.io/bloodf/durindoor:latest
```

### Source / npm

```bash
npm uninstall -g durindoor
```

Removing the data directory requires explicit operator action. Verify `DATA_DIR` is set and points to the intended path, then remove it manually. `~/.9router` (or `%APPDATA%\\9router` on Windows) is the same as `DATA_DIR` when no override is set — confirm which is in use before deleting.

## Related pages

- [Upgrading](upgrading.md)
- [Startup](startup.md)
- [Security](security.md)
