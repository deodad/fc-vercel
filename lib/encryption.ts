import crypto from 'crypto';

import { APP_SECRET_ENCRYPTION_KEY, APP_SECRET_ENCRYPTION_SALT } from './env.js';

const ALGORITHM = 'aes-256-cbc';
const KEY = crypto.pbkdf2Sync(
  APP_SECRET_ENCRYPTION_KEY,
  APP_SECRET_ENCRYPTION_SALT,
  100000, // Iterations
  32, // Key length in bytes (256 bits)
  'sha512' // Digest
);

export interface EncryptedBlob {
  iv: string;
  algorithm: string;
  encryptedData: string;
}

export function encrypt(bytes: Uint8Array): EncryptedBlob {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(KEY), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { iv: iv.toString('hex'), algorithm: ALGORITHM, encryptedData: encrypted.toString('hex') };
}

export function decrypt(blob: EncryptedBlob): Uint8Array {
  const iv = Buffer.from(blob.iv, 'hex');
  const encryptedText = Buffer.from(blob.encryptedData, 'hex');
  const decipher = crypto.createDecipheriv(blob.algorithm, Buffer.from(KEY), iv);
  const decrypted = Uint8Array.from(Buffer.concat([decipher.update(encryptedText), decipher.final()]));
  return decrypted;
}
