import { NextResponse } from 'next/server';
import { reportServerError } from './server-errors';

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export const ok = (data: any, status = 200) => NextResponse.json(data, { status, headers: noStoreHeaders });

export const fail = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status, headers: noStoreHeaders });

export function apiError(error: unknown) {
  const details = reportServerError(error);
  return NextResponse.json({ error: details.message, errorId: details.errorId, kind: details.kind }, {
    status: details.status,
    headers: { ...noStoreHeaders, 'X-Error-ID': details.errorId },
  });
}
