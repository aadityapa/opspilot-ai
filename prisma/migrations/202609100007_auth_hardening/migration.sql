-- Phase 5: authentication hardening.
--
-- Purely additive. Every new column has a default or is nullable, so existing rows are untouched
-- and the migration is safe on a populated database. No data is rewritten.

-- Second factor, lockout, password lifecycle and soft-deletion on User.
ALTER TABLE "User"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecret" TEXT,
  ADD COLUMN "mfaPendingSecret" TEXT,
  ADD COLUMN "mfaLastStep" INTEGER,
  ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMPTZ(3),
  ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3),
  ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(3),
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

-- Sessions become listable and individually revocable. The token hash stays the primary key; the
-- new id is what the interface shows and what revocation targets, so hashes never leave the server.
ALTER TABLE "Session"
  ADD COLUMN "id" TEXT,
  ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "mfaPending" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Session" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "Session" ALTER COLUMN "id" SET NOT NULL;
CREATE UNIQUE INDEX "Session_id_key" ON "Session"("id");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- One-time recovery codes, stored hashed and deleted on use.
CREATE TABLE "RecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode"("codeHash");

-- Password reset tokens, stored hashed, single use, short lived.
CREATE TABLE "PasswordReset" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  "requestedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- Security events without a signed-in actor (a failed login for an unknown address, a reset link
-- used anonymously) still belong in the audit log, so the actor becomes optional. A source address
-- is recorded for security events. Two indexes support the audit export and retention job.
ALTER TABLE "Event" DROP CONSTRAINT "Event_actorId_fkey";
ALTER TABLE "Event" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "Event" ADD COLUMN "ip" TEXT;
ALTER TABLE "Event" ADD CONSTRAINT "Event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Event_action_createdAt_idx" ON "Event"("action", "createdAt");
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");
