import crypto from 'crypto';
import { env } from '../config/index.js';

const ENC_ALGO = 'aes-256-gcm';
const KEY = Buffer.from(env.ENCRYPTION_KEY_B64, 'base64'); // 32 bytes

export function encrypt(plain) {
  if (!plain) return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join('.');
}

export function decrypt(payload) {
  if (!payload) return undefined;
  const [ivB64, ctB64, tagB64] = payload.split('.');
  if (!ivB64 || !ctB64 || !tagB64) throw new Error('Invalid encrypted payload');
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv(ENC_ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}
