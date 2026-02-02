import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config';

export interface EncryptedSecret {
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function loadKey(): Buffer {
  if (!config.gmailTokenEncKey) {
    throw new Error('GMAIL_TOKEN_ENC_KEY is not configured');
  }
  const normalized = config.gmailTokenEncKey.startsWith('0x')
    ? config.gmailTokenEncKey.slice(2)
    : config.gmailTokenEncKey;
  const key = Buffer.from(normalized, 'hex');
  if (key.length !== 32) {
    throw new Error('GMAIL_TOKEN_ENC_KEY must be 32 bytes (64 hex characters)');
  }
  return key;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = loadKey();
  }
  return cachedKey;
}

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey() as any, iv as any);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8') as any, cipher.final() as any]);
  const tag = cipher.getAuthTag();
  return {
    keyId: config.gmailTokenKeyId,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptSecret(payload?: EncryptedSecret | null): string | null {
  if (!payload) {
    return null;
  }

  // Allow decryption if keyId matches OR if it's missing (legacy support)
  if (payload.keyId && payload.keyId !== config.gmailTokenKeyId) {
    console.warn(`[Crypto] Warning: Key ID mismatch. Expected '${config.gmailTokenKeyId}', got '${payload.keyId}'. Attempting to decrypt anyway...`);
    // In a strict environment, we might throw here. For now, try to proceed.
  }

  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', getKey() as any, iv as any);
    decipher.setAuthTag(tag as any);
    const decoded = Buffer.concat([decipher.update(ciphertext as any) as any, decipher.final() as any]);
    return decoded.toString('utf8');
  } catch (error) {
    // Detailed logging for debugging
    console.error(`[Crypto] Decryption failed. KeyID: ${payload.keyId}, Expected: ${config.gmailTokenKeyId}`, error);
    throw new Error('Decryption failed');
  }
}
