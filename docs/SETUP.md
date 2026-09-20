# Setup on Windows

Every command is PowerShell, run from the repository root (the folder containing `package.json`).
Use `npm.cmd` if PowerShell blocks `npm.ps1`; you do not need to change your execution policy.

## The short version

You need **Node 24** and nothing else.

**Easiest:** double-click **`start.bat`** in the project folder. It checks for Node 24, runs setup the
first time, starts the application with whichever database it finds, and opens the browser. Leave
the window open while you use the app; Ctrl+C stops it.

From PowerShell, the same thing is:

```powershell
node --version          # expect v24.x — if not, install Node 24 LTS from nodejs.org
npm.cmd run setup
npm.cmd run dev         # or: npm.cmd run dev:local — setup tells you which
```

Open **http://localhost:5173** and sign in as `employee@opspilot.example`. The password is the
`DEMO_PASSWORD` line in the `.env` file that setup wrote. Try the catalog on *New ticket*, drag a
card on the *Board* as `engineer@opspilot.example`, press **Ctrl+K**, and — as
`admin@opspilot.example` — approve Maya's laptop request, then open **Account & security** to
enrol an authenticator app.

That is the whole thing. The rest of this page explains what `setup` did, and what to do when
something is not right.

---

## What `npm run setup` does

It is safe to run again at any time. It backs `.env` up before changing it, keeps every value you
have chosen, refuses to re-seed a database that holds real accounts, and never prints a password.

1. **Installs dependencies** if `node_modules` is missing.
2. **Repairs `.env`.** Copies your current one to `.env.backup`, then writes a file with every
   setting the application reads — your existing values kept, the missing ones filled in from
   `.env.example`. A `.env` from an earlier phase is upgraded rather than replaced.
3. **Finds a database**, in this order:
   1. whatever `DATABASE_URL` already points at, if something answers there;
   2. **Docker Compose** — `docker compose up -d db mailpit`, if Docker is installed and running;
   3. any PostgreSQL already listening on 5433, 5432 or 55439, with the usual local passwords;
   4. a **self-contained PostgreSQL 18**, downloaded on demand into `.local-db/`. No Docker, no
      service to install, no administrator rights. This is the fallback that makes the project run
      on a machine with nothing set up.
4. **Creates three databases** — `opspilot` for the application, `opspilot_test` and
   `opspilot_e2e_test` for the two test suites — and points the three URLs at them. The suites
   delete and rewrite records, so they never share a database with your working data.
5. **Applies the migrations**, loads the fictional demo data, and builds the retrieval index.
6. **Tells you which command to start with** — `dev` if you have a database of your own,
   `dev:local` if it fell back to the self-contained one.

### If it chose the self-contained database

```powershell
npm.cmd run dev:local     # database and application together, in one terminal
```

Or run them separately, which is easier to read when something goes wrong:

```powershell
npm.cmd run db:local      # terminal 1 — leave it open
npm.cmd run dev           # terminal 2
```

The data lives in `.local-db/` inside the repository and is git-ignored. Delete that folder to start
completely fresh. If the terminal is closed without Ctrl+C, PostgreSQL leaves a lock file behind;
the next start clears it automatically once it has confirmed the old process is gone.

### If you would rather use Docker

Docker Desktop is still the path `compose.yaml` describes, and setup prefers it when it is running.
It is the only way to get **Mailpit**, the local mail sink — without it, notifications are queued in
the outbox and never handed to a transport, which is what `MAIL_MODE=disabled` means.

```powershell
docker compose up -d db mailpit
npm.cmd run setup
```

| From | Database | Mailpit SMTP | Mailpit web |
| --- | --- | --- | --- |
| Windows (`npm run dev`, `npm test`) | `localhost:5433` | `127.0.0.1:1025` | http://localhost:8025 |
| Inside the app container (`--profile full`) | `db:5432` | `mailpit:1025` | — |

`db` and `mailpit` are container names on the compose network; they do not resolve from Windows.
Host port **5433** is deliberate, so it cannot collide with a PostgreSQL service already on 5432.

---

## Signing in

| Account | Role |
| --- | --- |
| employee@opspilot.example | Employee, Maya Chen |
| employee2@opspilot.example | Employee, Noah Williams |
| engineer@opspilot.example | IT Engineer, Alex Morgan |
| admin@opspilot.example | Administrator, Jordan Patel |

One password for all four: the `DEMO_PASSWORD` line in `.env`. Setup generates a random one rather
than shipping a fixed password, and does not print it, so it stays out of your shell history.

The demo organisation also contains ten more fictional colleagues — Engineering, Sales, Finance and
Customer Success — so the directory, departments, approvals and asset ownership have somebody to
point at. They exist to be looked at, not signed in as: each one is created with a random password
nobody is given. These four accounts are the only ones that can sign in.

Browse **localhost**, not `127.0.0.1`. Every mutation requires an exact `Origin` match against
`APP_ORIGIN`, so the two addresses are not interchangeable and mixing them gives HTTP 403.

AI runs in **mock** mode: deterministic, no credentials, no network calls, and labelled *Mock AI*
wherever it appears. `AI_MODE=disabled` switches every AI feature off and the rest of the
application is unaffected.

---

## Doing it by hand

Setup is a convenience, not a dependency — every step it takes is an ordinary command.

```powershell
Copy-Item .env.example .env            # then edit DATABASE_URL and set DEMO_PASSWORD yourself

docker compose up -d db mailpit
docker compose exec db createdb -U opspilot opspilot_test
docker compose exec db createdb -U opspilot opspilot_e2e_test

npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate

$env:ALLOW_DEMO_SEED = 'true'
$env:DEMO_PASSWORD = [guid]::NewGuid().ToString('N')
Write-Output $env:DEMO_PASSWORD        # save this
npm.cmd run db:seed
npm.cmd run ai:reindex
Remove-Item Env:ALLOW_DEMO_SEED, Env:DEMO_PASSWORD
```

`db:seed` creates four fictional accounts, six tickets, eleven assets and seven knowledge articles.
`ai:reindex` builds the retrieval index; without it every question correctly answers "not enough
evidence".

---

## Tests

```powershell
npm.cmd test            # API and unit suites, against opspilot_test
npx.cmd playwright install chromium
npm.cmd run test:e2e    # browser suite, against opspilot_e2e_test
npm.cmd run build       # typechecks both projects, then builds
npm.cmd audit --audit-level=high
```

No API key is needed for any test, and CI never has one. If you used the self-contained database,
start it first (`npm.cmd run db:local` in another terminal) — the suites need it running.

### The destructive-write guard

Before either suite runs, the target database is checked. The name must end in `_test` or
`_e2e_test`, it must not be the application database, and the database itself is inspected: one
holding non-demo accounts is refused, because that is what a real workspace looks like. A database
that passes is marked with a small table in its own `opspilot_guard` schema, so the decision is
recorded rather than re-guessed — and so Prisma still sees an empty `public` schema on a fresh
database.

If a database is genuinely disposable but the guard refuses it:

```powershell
npm.cmd run db:claim-test              # shows what is in each, changes nothing
npm.cmd run db:claim-test -- --confirm # claims them
```

Optional, both opt-in:

```powershell
npm.cmd run bench:retrieval        # retrieval latency (docs/RETRIEVAL.md); needs BENCH_DATABASE_URL
npm.cmd run verify:containers      # exercises Docker, PostgreSQL 18 and Mailpit end to end
```

---

## Running against a real AI provider

Only if you want to, and only with your own key. It costs money.

```powershell
$env:AI_MODE = 'openai'
$env:OPENAI_API_KEY = '<your key>'
npm.cmd run ai:reindex             # re-embed with the real model; the mock index is not compatible
npm.cmd run dev
```

Startup refuses `AI_MODE=openai` without a key, and refuses a key left behind in any other mode. The
key is read on the server only and is never sent to the browser or written to logs.

To run the evaluation set against a real provider: `npm.cmd run eval:real`.

---

## When something is wrong

Run this first. It checks every setting, every database, the migration state and the retrieval
index, and names the fix:

```powershell
npm.cmd run doctor
```

| Symptom | Cause and fix |
| --- | --- |
| `P1001` / cannot connect | No database is running. `npm.cmd run db:local`, or `docker compose up -d db` — host port is **5433**, not 5432 |
| `npm test` complains about `TEST_DATABASE_URL` | Your `.env` predates the current `.env.example`. `npm.cmd run setup` repairs it in place |
| `database "opspilot_test" does not exist` | `npm.cmd run setup` creates all three |
| "lock file … already exists" | A previous local database was killed rather than stopped. Starting again clears the lock once it has confirmed the process is gone. If it names a process that really is running, stop that server — or set `LOCAL_DB_PORT` to a free port |
| Guard refuses a test database | Read the message. If it is genuinely disposable: `npm.cmd run db:claim-test -- --confirm` |
| The evaluation refuses to run, naming published articles | Something else left articles in the test database. Recreate it, or run `npm.cmd run setup` after dropping it |
| HTTP 403 on every save | You browsed `127.0.0.1` instead of `localhost`, or the session expired. Match `APP_ORIGIN` exactly and sign in again |
| Ask AI always says "not enough evidence" | The retrieval index is empty. `npm.cmd run ai:reindex` |
| Index shows "Stale — embedding model changed" | You changed `AI_EMBEDDING_MODEL` or the dimensions. Reindex |
| No mail in Mailpit | Mailpit only exists under Docker. `MAIL_MODE=mailpit`, the container running, and the worker runs every 30 seconds |
| Port already in use | The browser suite uses 3002/5174, the dev server 3001/5173, the database 5433. Stop whatever else holds them |
