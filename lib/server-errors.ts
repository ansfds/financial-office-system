import { errorDetails, errorRecord, newErrorId, safeErrorId } from './error-info';

export function databaseError(error: unknown) {
  const details = errorDetails(error);
  const digest = safeErrorId(error) || newErrorId(details);
  if (process.env.NODE_ENV !== 'production' && error instanceof Error) {
    Object.assign(error, { digest });
    return error;
  }
  // Next also logs render exceptions: never forward query arguments or connection details.
  return Object.assign(new Error(details.message), {
    name: 'DatabaseError', code: errorRecord(error).code || errorRecord(error).errorCode,
    digest,
  });
}

export function reportServerError(error: unknown, context: { route?: string; method?: string } = {}) {
  const details = errorDetails(error);
  const record = errorRecord(error);
  const errorId = safeErrorId(error) || newErrorId(details);
  const diagnosticCode = [record.code, record.errorCode, record.message].find(value =>
    typeof value === 'string' && (/^P\d{4}$/.test(value) || ['DATABASE_SCHEMA_MISMATCH', 'SESSION_SECRET_MISSING'].includes(value)));
  const entry = { errorId, kind: details.kind, status: details.status,
    code: diagnosticCode,
    route: context.route?.split('?')[0], method: context.method };
  if (process.env.NODE_ENV === 'production') {
    if (details.status < 500) console.warn(JSON.stringify(entry));
    else console.error(JSON.stringify(entry));
  }
  else console.error(entry, error);
  return { ...details, errorId };
}
