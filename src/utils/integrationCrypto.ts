import crypto from 'crypto';

const DEFAULT_SECRET = process.env.JWT_SECRET || 'creatorlab-dev-secret';

function getKey(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || DEFAULT_SECRET;
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivBase64, authTagBase64, encryptedBase64] = payload.split(':');

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
