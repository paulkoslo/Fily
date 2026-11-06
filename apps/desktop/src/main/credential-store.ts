import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { safeStorage } from 'electron';
import { z } from 'zod';

export type Credentials = { openrouter?: string; openai?: string };
export type SecretCipher = {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};

const KeySchema = z.string().min(10).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/);
const CiphertextSchema = z.string().min(1).max(16384).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const StoreSchema = z.object({
  version: z.literal(1),
  keys: z.object({ openrouter: CiphertextSchema.optional(), openai: CiphertextSchema.optional() }).strict(),
}).strict();

const osCipher: SecretCipher = {
  isAvailable: () => Boolean(safeStorage?.isEncryptionAvailable()) &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
};

export function validateApiKey(value: string): string {
  const parsed = KeySchema.safeParse(value.trim());
  if (!parsed.success) throw new Error('API key must be 10–4096 characters with no whitespace or control characters');
  return parsed.data;
}

/** Commit a private file by rename; never truncate the last known good copy. */
export function writePrivateFile(filePath: string, contents: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.fily-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filePath);
    // Make the rename durable before a caller removes legacy plaintext keys.
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export class EncryptedCredentialStore {
  readonly filePath: string;
  constructor(directory: string, private readonly cipher: SecretCipher = osCipher) {
    this.filePath = path.join(directory, 'credentials.json');
  }

  private requireEncryption(): void {
    if (!this.cipher.isAvailable()) {
      throw new Error('OS credential storage is unavailable or locked. Unlock your keychain and restart Fily.');
    }
  }

  read(): Credentials {
    if (!fs.existsSync(this.filePath)) return {};
    let stored: z.infer<typeof StoreSchema>;
    try {
      if (fs.statSync(this.filePath).size > 65536) throw new Error('Oversized credential store');
      stored = StoreSchema.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch {
      throw new Error('Stored credentials could not be read. The existing file has been preserved.');
    }
    if (Object.keys(stored.keys).length > 0) this.requireEncryption();
    try {
      const keys: Credentials = {};
      for (const provider of ['openrouter', 'openai'] as const) {
        const ciphertext = stored.keys[provider];
        if (ciphertext) keys[provider] = validateApiKey(this.cipher.decrypt(Buffer.from(ciphertext, 'base64')));
      }
      return keys;
    } catch {
      throw new Error('Stored credentials could not be decrypted. Unlock your keychain and restart Fily; the existing file has been preserved.');
    }
  }

  write(keys: Credentials): void {
    const encrypted: Credentials = {};
    if (Object.values(keys).some(Boolean)) this.requireEncryption();
    for (const provider of ['openrouter', 'openai'] as const) {
      if (!keys[provider]) continue;
      const value = validateApiKey(keys[provider]!);
      try {
        const ciphertext = this.cipher.encrypt(value);
        if (this.cipher.decrypt(ciphertext) !== value) throw new Error('Verification failed');
        encrypted[provider] = ciphertext.toString('base64');
      } catch {
        throw new Error('Credential encryption failed. The existing saved credentials have been preserved.');
      }
    }
    try {
      writePrivateFile(this.filePath, JSON.stringify({ version: 1, keys: encrypted }) + '\n');
    } catch {
      throw new Error('Credentials could not be saved. Check access to Fily’s application data directory.');
    }
  }
}
