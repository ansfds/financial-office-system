import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorDetails, safeErrorId } from '@/lib/error-info';
import { databaseError, reportServerError } from '@/lib/server-errors';
import { apiError } from '@/lib/http';
import { apiFetch, readApiJson, ApiRequestError } from '@/lib/api-client';
import { databaseReady } from '@/lib/database-readiness';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('data failure diagnosis', () => {
  it.each(['P2021', 'P2022'])('identifies missing schema %s without blaming the session', code => {
    const info = errorDetails({ code });
    expect(info).toMatchObject({ kind: 'DB', status: 500 });
    expect(info.message).not.toContain('الدخول');
  });
  it.each(['P1001', 'P2024'])('identifies unavailable databases %s', code => {
    expect(errorDetails({ code })).toMatchObject({ kind: 'DB', status: 503 });
  });
  it('distinguishes session expiry, permissions, network failures and server errors', () => {
    expect(errorDetails(new Error('UNAUTHORIZED'))).toMatchObject({ kind: 'AUTH', status: 401 });
    expect(errorDetails(new Error('FORBIDDEN'))).toMatchObject({ kind: 'PERMISSION', status: 403 });
    expect(errorDetails(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'NETWORK', status: 503 });
    expect(errorDetails(new Error('private detail'))).toMatchObject({ kind: 'SERVER', status: 500 });
  });
  it('recognizes connection initialization failures even when Prisma omits errorCode', () => {
    expect(errorDetails({ name: 'PrismaClientInitializationError' })).toMatchObject({ kind: 'DB', status: 503 });
    expect(errorDetails({ name: 'PrismaClientInitializationError', errorCode: 'P1013' })).toMatchObject({ kind: 'DB', status: 500 });
  });
  it('preserves an error ID across the sanitized Prisma error, API response and log', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = Object.assign(new Error('postgresql://name:SECRET_PASSWORD@private-host/database?token=SECRET_TOKEN'), { code: 'P2022' });
    const safe = databaseError(original);
    const response = apiError(safe);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.kind).toBe('DB');
    expect(body.errorId).toMatch(/^DATA-DB-500-[A-F0-9]{12}$/);
    expect(response.headers.get('X-Error-ID')).toBe(body.errorId);
    expect(errorDetails({ digest: body.errorId }).kind).toBe('DB');
    expect(JSON.parse(log.mock.calls[0][0]).errorId).toBe(body.errorId);
    for (const secret of ['SECRET_PASSWORD', 'private-host', 'SECRET_TOKEN', 'postgresql://']) {
      expect(safe.stack).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(body)).not.toContain(secret);
    }
  });
  it('logs original diagnostic details only during development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = Object.assign(new Error('diagnostic detail'), { code: 'P2021' });
    expect(databaseError(original)).toBe(original);
    reportServerError(original);
    expect(log.mock.calls[0][1]).toBe(original);
  });
  it('retains the Next digest for correlation but rejects unsafe digest text', () => {
    expect(safeErrorId({ digest: '123456789' })).toBe('DATA-SERVER-500-123456789');
    expect(safeErrorId({ digest: 'postgresql://private:secret@host/db' })).toBeUndefined();
  });
  it('never records tokens in request query strings', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportServerError(new Error('private detail'), { route: '/customers?token=SECRET', method: 'GET' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private detail');
  });
});

describe('API response parsing', () => {
  it('does not parse an HTML server error as JSON or expose its contents', async () => {
    const response = new Response('<html>private server detail</html>', { status: 500, headers: { 'Content-Type': 'text/html' } });
    await expect(readApiJson(response)).rejects.toMatchObject({ name: 'ApiRequestError', status: 500, kind: 'SERVER' });
  });
  it('rejects empty JSON instead of creating fallback data', async () => {
    await expect(readApiJson(new Response('', { headers: { 'Content-Type': 'application/json' } }))).rejects.toBeInstanceOf(ApiRequestError);
  });
  it('keeps successful payloads and duplicate-customer confirmations intact', async () => {
    const person = { id: 'person-id' };
    expect(await readApiJson(Response.json([person]))).toEqual([person]);
    expect(await readApiJson(Response.json({ duplicate: person }, { status: 409 }))).toEqual({ duplicate: person });
  });
  it.each([[401, 'AUTH'], [403, 'PERMISSION']])('preserves HTTP %s as %s', async (status, kind) => {
    await expect(readApiJson(Response.json({ error: 'not shown' }, { status: Number(status) }))).rejects.toMatchObject({ status, kind });
  });
  it('shows the same database error ID returned by the API', async () => {
    const errorId = 'DATA-DB-500-1234ABCDEF00';
    const response = Response.json({ error: 'database failed', errorId }, { status: 500 });
    await expect(readApiJson(response)).rejects.toMatchObject({ kind: 'DB', errorId, message: expect.stringContaining(errorId) });
  });
  it('distinguishes failed connections while preserving deliberate request cancellation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/people')).rejects.toMatchObject({ status: 0, kind: 'NETWORK' });
    const abort = new DOMException('Cancelled', 'AbortError');
    fetchSpy.mockRejectedValueOnce(abort);
    await expect(apiFetch('/api/cards')).rejects.toBe(abort);
  });
});

describe('deployment schema readiness', () => {
  const ready = { connection: 1, secondaryPhone: true, dailyNotes: true, cardStates: true };
  it('requires a real database connection and all schema additions', () => {
    expect(databaseReady(ready)).toBe(true);
    expect(databaseReady(undefined)).toBeFalsy();
    expect(databaseReady({ ...ready, connection: 0 })).toBe(false);
  });
  it.each(['secondaryPhone', 'dailyNotes', 'cardStates'] as const)('blocks deployment with missing %s', key => {
    expect(databaseReady({ ...ready, [key]: false })).toBe(false);
  });
});
