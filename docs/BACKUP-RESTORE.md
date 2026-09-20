# Backup and restore

OpsPilot keeps its state in two places: the PostgreSQL database and the attachment directory
(`UPLOAD_DIR`; the `uploads` volume in production). A backup is complete only when it holds both
from the same moment. Standard PostgreSQL tooling does the work; the two scripts in `scripts/` only
choose the right tool and refuse to run a restore without an explicit confirmation.

Nothing below prints or stores a password: the scripts pass it to `pg_dump`/`pg_restore` through
`PGPASSWORD` in the child process environment, never on the command line.

## Backup

### Windows or developer machine

```powershell
npm.cmd run db:backup                 # → backups\opspilot-<timestamp>.dump
npm.cmd run db:backup -- --out D:\backups\opspilot-friday.dump
```

The script tries, in order: `pg_dump` on `PATH` (custom format, compressed, `--no-owner
--no-privileges`); `pg_dump` inside the compose `db` container; and, for the embedded database in
`.local-db/`, a file-level copy (`backups\opspilot-localdb-<timestamp>.tar`) — which requires the
database to be **stopped** first (Ctrl+C in its window), because a copy taken while PostgreSQL is
writing is not guaranteed to be consistent. The script refuses to copy a running one.

Then copy the attachment folder: `Copy-Item -Recurse uploads D:\backups\uploads-<timestamp>`.

Installing the PostgreSQL client tools on Windows (for `pg_dump`) — the EDB installer's "Command
Line Tools" component — is the recommended path; the file copy is the fallback.

### Production container

```bash
# database, from the db container, streamed to the host
docker compose -f compose.prod.yaml exec -T db pg_dump -U opspilot --format=custom --no-owner --no-privileges opspilot > opspilot-$(date +%F).dump

# attachments, from the uploads volume
docker run --rm -v opspilot-prod_uploads:/data:ro -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Take the two within the same minute, or stop `app` first for a strictly consistent pair (`docker
compose -f compose.prod.yaml stop app`; start it again afterwards).

## Restore

Restoring **replaces** the target database. The script always shows what it is about to overwrite
(database name, host, current account and ticket counts) and does nothing without `--confirm`.

### Windows or developer machine

```powershell
npm.cmd run db:restore -- backups\opspilot-2026-09-20.dump             # dry run: shows the target
npm.cmd run db:restore -- backups\opspilot-2026-09-20.dump --confirm   # does it
```

`.dump` files go through `pg_restore --clean --if-exists --single-transaction` (natively or inside
the compose `db` container). A `.tar` from the embedded database is unpacked over `.local-db\data`
— stop the database first; the script refuses while it is running. Afterwards run `npm.cmd run
db:migrate` in case the backup predates the current schema, then `npm.cmd run doctor`.

Restore attachments by replacing the `uploads` folder with the copy from the same backup.

### Production container

```bash
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml exec -T db pg_restore -U opspilot --clean --if-exists --no-owner --no-privileges --single-transaction --dbname opspilot < opspilot-2026-09-20.dump
docker run --rm -v opspilot-prod_uploads:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/uploads-2026-09-20.tgz -C /data"
docker compose -f compose.prod.yaml run --rm migrate      # brings an older backup up to the current schema
docker compose -f compose.prod.yaml start app
```

## Verify

After a restore, in this order:

1. `curl -s http://localhost:3001/api/health/ready` → `{"status":"ready"}`.
2. Sign in as an administrator; open **Administration → Overview** — account and ticket counts
   match the moment of the backup.
3. Open a ticket that had an attachment and download the file — proves the two stores are from the
   same moment.
4. `Administration → Audit log` shows the restore's own sign-in as the newest entry and nothing
   after the backup time before it.

Rehearse this on a copy (a scratch database name) before relying on it: `npm run db:restore` will
happily point at whatever `DATABASE_URL` names.

## Rollback expectations

- Application rollback (older image) needs **no** database restore: migrations are additive, so an
  older version runs on a newer schema.
- Database rollback (restore) discards every change made after the backup — tickets, replies,
  approvals, audit rows. Say so to the people affected before doing it.
- A restore without the matching attachment copy leaves `Attachment` rows whose files answer
  "The file is no longer available"; nothing else breaks.
- Sessions in the backup are usually expired by restore time; everyone signs in again. Second-factor
  secrets are encrypted with `APP_SECRET`: restoring into an installation with a **different**
  `APP_SECRET` makes every authenticator unreadable and each person must enrol again.

## What was exercised for RC1

The file-level path was run end to end in this phase on a fresh installation: backup (79.8 MB tar
of the stopped embedded database), a marker change to a ticket, dry run, `--confirm` restore, and
the marker gone with the row counts back to the backup's. `pg_dump`/`pg_restore` were not available
in the verification sandbox, so the custom-format path is verified by inspection of the commands
above and of the scripts, not by execution — run the Verify list once on your own host.
