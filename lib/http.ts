import { NextResponse } from 'next/server';

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export const ok = (data: any, status = 200) => NextResponse.json(data, { status, headers: noStoreHeaders });

export const fail = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status, headers: noStoreHeaders });

export function apiError(e: any) {
  if (e?.message === 'UNAUTHORIZED') return fail('انتهت الجلسة أو غير مصرح بالدخول. سجل الدخول من جديد.', 401);
  if (e?.message === 'SESSION_SECRET_MISSING') return fail('إعداد الجلسة غير مكتمل في الخادم.', 500);
  console.error(e);
  return fail('حدث خطأ غير متوقع', 500);
}
