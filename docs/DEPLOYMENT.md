# Production deployment

A single-host deployment with Docker Compose: TLS at the edge, the application unprivileged and
port-less behind it, PostgreSQL on a private network. It is the smallest arrangement that is
defensible to run for real; it is not a high-availability design, and it does not pretend to be.

**Status:** the image, the compose file and the pre-flight check are written and reviewed; the
CI workflow builds the image and boots it against a database. None of it has been executed on a
real host in this repository's history, because Docker is unavailable where this project was
validated. Treat the first deployment as the test it is — see [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

## What you need

- A Linux host with Docker Engine 24+ and the Compose plugin.
- A DNS name pointing at it, with ports 80 and 443 reachable (Caddy obtains certificates over ACME).
- Somewhere off the host to keep backups.

## First deployment

```bash
git clone <your repository> opspilot && cd opspilot
cp .env.production.example .env.production
# Fill in DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, APP_SECRET. Generators:
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # POSTGRES_PASSWORD
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # APP_SECRET

npm ci                                    # only to run the pre-flight; the image builds itself
npm run doctor:prod                       # validates .env.production exactly as the app will

docker compose -f compose.prod.yaml --env-file .env.production up -d --build
docker compose -f compose.prod.yaml logs -f app     # wait for {"message":"listening"}
```

Then create the first administrator. There is no public registration and the demo seed is refused
in production, so the first account is created directly:

```bash
docker compose -f compose.prod.yaml exec \
  -e FIRST_EMAIL=you@example.com -e FIRST_NAME="Your Name" \
  -e FIRST_PASSWORD="a temporary passphrase you will replace" \
  app node dist/server/cli/create-admin.js
```

The same command works locally as `npm run admin:create` with the three variables set. It refuses
to run once an administrator exists; every later account is created from the Users page, where the
action is attributed and audited.

Sign in at `https://<DOMAIN>`; you are asked to replace the temporary password and, because
`MFA_REQUIRED_ROLES` defaults to `ADMIN`, to enrol an authenticator before anything else works.

## What the compose file does

| Service | Role | Exposure |
| --- | --- | --- |
| `caddy` | TLS termination, HSTS, reverse proxy, adds `X-Request-Id` | 80, 443 on the host |
| `app` | The image, `NODE_ENV=production`, read-only filesystem, no capabilities, 512 MB limit | none; `backend` + `edge` networks |
| `migrate` | Same image, runs `prisma migrate deploy` once, exits | none |
| `db` | `pgvector/pgvector:pg18`, named volume | none; `backend` network is internal (no internet) |

`app` waits for `migrate` to complete and starts with `SKIP_MIGRATIONS=1`, so a replica never runs
DDL. Health is `GET /api/health/ready`; Caddy only starts routing once it passes.

Caddy refuses `/metrics` at the edge. Scrape it from inside the `backend` network with the bearer
token in `METRICS_TOKEN` — see [OPERATIONS.md](OPERATIONS.md).

## Attachments

The container runs read-only; the one writable path is the `uploads` volume mounted at
`/app/uploads` (`UPLOAD_DIR`). Back it up alongside the database — `Attachment` rows reference
files by random storage key, and a restore without the files leaves downloads answering 404 rather
than serving the wrong bytes. `ATTACHMENT_MAX_MB` (default 10) caps each file.

## Upgrading

```bash
git pull
npm run doctor:prod                                   # catches a newly required setting
npm run db:backup                                     # see OPERATIONS.md for where this writes
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

Migrations are additive and run before the new application container starts; expect a short
interruption while Compose replaces the container. If a migration fails, `migrate` exits non-zero
and the new `app` never starts — nothing is half-applied, because Prisma applies each migration in
its own transaction. Fix the cause and run the same command again.

## Rolling back

The application can be rolled back to a previous image tag (`IMAGE_TAG=<previous>`), but
migrations are forward-only. Every migration in this repository is additive — new tables, nullable
columns, defaults — so an older application version runs against a newer schema. Restoring a
database backup is the rollback for data, not for schema.

## What is deliberately not here

- **Multiple application replicas.** The rate limiter and metrics counters are process-local.
  Running two replicas works, but each has its own counters and limits. A shared store is the
  first thing to add if you scale out.
- **Managed secrets.** Secrets live in `.env.production` on the host. Move them to your platform's
  secret store when you have one; the compose file only reads environment variables, so nothing
  else changes.
- **Mail.** Production runs with `MAIL_MODE=disabled`; notifications are queued and visible in the
  application. Delivery to a real SMTP relay is a deliberate omission — see
  [SECURITY.md](SECURITY.md) for why the transport was fixed to a local sink.
- **Object storage, attachments, SSO.** See [ROADMAP.md](ROADMAP.md).
