import { createHmac, timingSafeEqual } from 'crypto';
import type { AssistantIntent, AssistantPreview } from './schema';

export type AssistantConfirmationPayload = {
  version: 1;
  idempotencyKey: string;
  originalCommand: string;
  transcript?: string;
  intent: AssistantIntent;
  preview: AssistantPreview;
  sessionId: string;
  expiresAt: number;
};

function assistantSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error('SESSION_SECRET_MISSING');
  return secret;
}

function signBody(body: string) {
  return createHmac('sha256', assistantSecret()).update(body).digest('base64url');
}

export function createAssistantConfirmationToken(payload: AssistantConfirmationPayload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${signBody(body)}`;
}

export function verifyAssistantConfirmationToken(token: string, sessionId: string): AssistantConfirmationPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('INVALID_ASSISTANT_CONFIRMATION');

  const expected = signBody(body);
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new Error('INVALID_ASSISTANT_CONFIRMATION');
    }
  } catch {
    throw new Error('INVALID_ASSISTANT_CONFIRMATION');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AssistantConfirmationPayload;
  if (payload.version !== 1 || payload.sessionId !== sessionId || payload.expiresAt < Date.now()) {
    throw new Error('INVALID_ASSISTANT_CONFIRMATION');
  }

  return payload;
}
