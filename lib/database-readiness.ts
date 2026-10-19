import { Prisma } from '@prisma/client';

export type DatabaseReadiness = { connection: number; secondaryPhone: boolean; dailyNotes: boolean; cardStates: boolean };
export const databaseReadinessQuery = Prisma.sql`
  SELECT 1::int AS connection,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Person' AND column_name='phoneSecondary') AS "secondaryPhone",
    (to_regclass('public."DailyNote"') IS NOT NULL) AS "dailyNotes",
    ((SELECT COUNT(*) FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='ReceivedCardStatus' AND e.enumlabel IN ('PAYMENT_FAILED','INSUFFICIENT_BALANCE')) = 2) AS "cardStates"`;
export function databaseReady(result?: DatabaseReadiness) {
  return result?.connection === 1 && result.secondaryPhone && result.dailyNotes && result.cardStates;
}
