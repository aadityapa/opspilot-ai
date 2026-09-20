-- CreateTable
CREATE TABLE "SlaPolicy" (
    "priority" "Priority" NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("priority")
);

-- CreateTable
CREATE TABLE "TicketSla" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "responseDueAt" TIMESTAMPTZ(3) NOT NULL,
    "responseSatisfiedAt" TIMESTAMPTZ(3),
    "responseBreachAt" TIMESTAMPTZ(3),
    "resolutionBreachAt" TIMESTAMPTZ(3),
    "elapsedMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "runningSince" TIMESTAMPTZ(3),
    "legacyBackfill" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TicketSla_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketSla_ticketId_key" ON "TicketSla"("ticketId");

-- AddForeignKey
ALTER TABLE "TicketSla" ADD CONSTRAINT "TicketSla_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Starter targets are configurable demo policy, not historical contractual commitments.
INSERT INTO "SlaPolicy" (priority,"responseMinutes","resolutionMinutes","updatedAt") VALUES
('LOW',480,4320,CURRENT_TIMESTAMP),('MEDIUM',240,1440,CURRENT_TIMESTAMP),
('HIGH',60,480,CURRENT_TIMESTAMP),('URGENT',15,120,CURRENT_TIMESTAMP);
-- No prior waiting intervals were stored. Give active legacy tickets a clearly marked
-- fresh clock at upgrade; preserve every original timestamp and prior reply.
INSERT INTO "TicketSla" (id,"ticketId",priority,"responseMinutes","resolutionMinutes","startedAt","responseDueAt","responseSatisfiedAt","runningSince","legacyBackfill")
SELECT gen_random_uuid()::text,t.id,t.priority,p."responseMinutes",p."resolutionMinutes",CURRENT_TIMESTAMP,
CURRENT_TIMESTAMP+make_interval(mins=>p."responseMinutes"),t."firstRespondedAt" AT TIME ZONE 'UTC',
CASE WHEN t.status='WAITING_FOR_USER' THEN NULL ELSE CURRENT_TIMESTAMP END,true
FROM "Ticket" t JOIN "SlaPolicy" p ON p.priority=t.priority
WHERE t.status IN ('OPEN','IN_PROGRESS','WAITING_FOR_USER');
