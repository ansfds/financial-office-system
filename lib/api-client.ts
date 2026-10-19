import { errorDetails, newErrorId, type ErrorKind } from './error-info';

export class ApiRequestError extends Error {
  constructor(message: string, public status: number, public kind: ErrorKind, public errorId?: string) {
    super(errorId ? `${message} (خطأ رقم: ${errorId})` : message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  try { return await fetch(input, init); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiRequestError('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجددًا.', 0, 'NETWORK');
  }
}

export async function readApiJson<T = any>(response: Response): Promise<T> {
  const headerId = response.headers.get('X-Error-ID') || undefined;
  let payload: any;
  try {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Non-JSON response');
    payload = await response.json();
  } catch {
    const info = response.status === 401 ? errorDetails(new Error('UNAUTHORIZED'))
      : response.status === 403 ? errorDetails(new Error('FORBIDDEN')) : errorDetails(undefined);
    throw new ApiRequestError(info.message, response.status, info.kind, headerId || newErrorId(info));
  }
  if (response.status === 401 || response.status === 403 || response.status >= 500) {
    const info = response.status === 401 ? errorDetails(new Error('UNAUTHORIZED'))
      : response.status === 403 ? errorDetails(new Error('FORBIDDEN'))
      : errorDetails({ digest: typeof payload?.errorId === 'string' ? payload.errorId : undefined });
    throw new ApiRequestError(info.message, response.status, info.kind,
      typeof payload?.errorId === 'string' && /^DATA-[A-Z]+-\d{3}-[A-Za-z0-9_-]+$/.test(payload.errorId) ? payload.errorId : headerId);
  }
  return payload as T;
}
