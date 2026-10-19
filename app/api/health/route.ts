import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { databaseReadinessQuery, databaseReady, type DatabaseReadiness } from '@/lib/database-readiness';
import { reportServerError } from '@/lib/server-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const [result] = await db.$queryRaw<DatabaseReadiness[]>(databaseReadinessQuery);
    if (!databaseReady(result)) throw Object.assign(new Error('Database schema is not ready'), { code: 'DATABASE_SCHEMA_MISMATCH' });
    return NextResponse.json({ app: 'ok', database: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { errorId } = reportServerError(error, { route: '/api/health', method: 'GET' });
    return NextResponse.json({ app: 'ok', database: 'error', errorId }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'X-Error-ID': errorId },
    });
  }
}
