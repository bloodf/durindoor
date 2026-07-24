# Upgrading DurinDoor

Check [CHANGELOG.md](../../CHANGELOG.md) before any upgrade. Breaking changes, schema migrations, and behavior shifts are documented there.

## Backup first

Stop DurinDoor before backing up so the database is not mid-write.

For a host bind mount, follow [Data Management](data-management.md#backing-up-a-host-directory).

For a Docker named volume, follow [Data Management](data-management.md#backing-up-a-docker-named-volume).
## Image / version pin change

### Docker

Pin to a version tag in production. `latest` is convenient for quick evaluation.

```bash
# Pull the new version
docker pull ghcr.io/bloodf/durindoor:3.9.0

# Stop and remove the old container (data is on a named volume)
docker stop durindoor && docker rm durindoor

# Start with the new image and the same volume / env
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -v durindoor-data:/app/data \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="your-secret" \
  -e API_KEY_SECRET="your-secret" \
  -e INITIAL_PASSWORD="your-password" \
  ghcr.io/bloodf/durindoor:3.9.0
```

Or update the `image:` line in `docker-compose.yml` and run `docker compose up -d`.

### Source

```bash
git pull
npm install --no-audit --no-fund
npm run build
npm start
```

### npm

```bash
npm update -g durindoor
```

## Schema migrations

DurinDoor's SQLite database runs forward-only migrations on startup. The migration chain is append-only and idempotent.

- DurinDoor starts fine with a fresh database.
- A full backup before upgrading lets you restore to the prior state if a migration fails or produces unexpected results.

Do not manually edit, delete, or truncate `DATA_DIR/db/data.sqlite`.

## Health verification after upgrade

```bash
curl http://localhost:20128/api/health
```

Then verify providers, API keys, combos, and usage in the dashboard.

## Rollback

Rollback reverts to the prior image or source revision and restores the backup.

**Docker:**

Named volume: follow [Data Management](data-management.md#restoring-a-docker-named-volume) to restore from your pre-upgrade backup.


Host bind mount: verify `DATA_DIR` is set to an absolute path on the host, then follow [Data Management](data-management.md#restoring-a-host-directory) to restore from your pre-upgrade backup, then restart with the old image:

```bash
case "$DATA_DIR" in
  /*) ;;
  *) echo "ERROR: DATA_DIR must be an absolute path, got '$DATA_DIR'" >&2; exit 1 ;;
esac
docker stop durindoor && docker rm durindoor
docker run -d \
  --name durindoor \
  --env-file .env \
  -p 20128:20128 \
  -v "$DATA_DIR:/app/data" \
  -e DATA_DIR=/app/data \
  ghcr.io/bloodf/durindoor:<old-version>
```

**Source:** `git checkout <prior-tag>` and rebuild.

A rollback cannot undo a completed migration that altered the database. If the database was migrated, restore from the pre-upgrade backup before starting the old binary.

## Related pages

- [CHANGELOG.md](../../CHANGELOG.md)
- [Data Management](data-management.md)
- [Startup](startup.md)
