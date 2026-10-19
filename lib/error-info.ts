export type ErrorKind = 'AUTH' | 'PERMISSION' | 'DB' | 'NETWORK' | 'SERVER';
export type ErrorDetails = { kind: ErrorKind; status: number; message: string };
export type ErrorRecord = { code?: string; errorCode?: string; message?: string; digest?: string; name?: string };

export function errorRecord(error: unknown): ErrorRecord {
  return error && typeof error === 'object' ? error as ErrorRecord : {};
}

export function errorDetails(error: unknown): ErrorDetails {
  const record = errorRecord(error);
  const digest = record.digest?.match(/^DATA-(AUTH|PERMISSION|DB|NETWORK|SERVER)-(\d{3})-/);
  const code = record.code || record.errorCode || '';
  if (record.message === 'UNAUTHORIZED' || digest?.[1] === 'AUTH')
    return { kind: 'AUTH', status: 401, message: 'انتهت الجلسة. سجّل الدخول للمتابعة.' };
  if (record.message === 'FORBIDDEN' || digest?.[1] === 'PERMISSION')
    return { kind: 'PERMISSION', status: 403, message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.' };
  if (/^P\d{4}$/.test(code) || code === 'DATABASE_SCHEMA_MISMATCH' || record.name?.startsWith('Prisma') || digest?.[1] === 'DB') {
    const unavailable = ['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code)
      || (record.name === 'PrismaClientInitializationError' && !['P1012', 'P1013'].includes(code))
      || digest?.[2] === '503';
    return { kind: 'DB', status: unavailable ? 503 : 500,
      message: unavailable ? 'تعذر الاتصال بقاعدة البيانات. حاول لاحقًا.' : 'تعذر قراءة البيانات من قاعدة البيانات. يرجى التواصل مع المسؤول.' };
  }
  if (digest?.[1] === 'NETWORK' || (record.name === 'TypeError' && /fetch|network|load failed/i.test(record.message || '')))
    return { kind: 'NETWORK', status: 503, message: 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجددًا.' };
  return { kind: 'SERVER', status: 500, message: 'حدث خطأ في الخادم. حاول مجددًا أو تواصل مع المسؤول.' };
}

export function safeErrorId(error: unknown) {
  const digest = errorRecord(error).digest;
  if (!digest) return undefined;
  const tagged = digest.match(/^DATA-(?:AUTH|PERMISSION|DB|NETWORK|SERVER)-\d{3}-[A-Za-z0-9_-]{1,80}/);
  if (tagged) return tagged[0];
  return /^[A-Za-z0-9_-]{1,80}$/.test(digest) ? `DATA-SERVER-500-${digest}` : undefined;
}

export function newErrorId(details: ErrorDetails) {
  return `DATA-${details.kind}-${details.status}-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}
