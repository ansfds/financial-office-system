import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function key() {
  const secret =
    process.env.CARD_ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.SYSTEM_ACCESS_CODE;

  if (!secret) {
    throw new Error('CARD_ENCRYPTION_KEY is required to protect card secrets');
  }

  return createHash('sha256').update(secret).digest();
}

export function encryptField(value?: string | null) {
  const plain = value?.trim();
  if (!plain) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptField(value?: string | null) {
  if (!value) return '';

  const [version, iv, tag, encrypted] = value.split(':');
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error('Unsupported encrypted field format');
  }

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
