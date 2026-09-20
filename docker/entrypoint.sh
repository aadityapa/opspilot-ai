#!/bin/sh
# Applies pending migrations, then runs the command. Migrations are additive and idempotent, so
# running this on every start is safe; a second replica starting at the same time simply finds
# nothing left to apply (Prisma takes an advisory lock while it works).
#
# Set SKIP_MIGRATIONS=1 to run the server without touching the schema — for a replica that must
# never hold DDL privileges, with migrations applied by a separate job (see compose.prod.yaml).
set -eu
# Is the database there at all? Refuses to continue (exit 10) when nothing answers, the password is
# wrong, or the database does not exist — migrations must never create one by accident.
node dist/server/preflight.js
if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo '{"level":"info","message":"applying migrations"}'
  node node_modules/prisma/build/index.js migrate deploy
fi
exec "$@"
