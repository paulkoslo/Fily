import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

export type ApiKeyStatus = {
  hasKey: boolean;
  maskedKey?: string;
};

type ApiKeyStoreOptions = {
  appName?: string;
  baseEnvPaths?: string[];
};

export class ApiKeyStore {
  private readonly appName: string;
  private readonly baseEnvPaths: string[];
  private readonly userDataPath: string;
  private readonly userEnvPath: string;

  constructor(options: ApiKeyStoreOptions = {}) {
    this.appName = options.appName ?? 'Fily';
    this.baseEnvPaths = options.baseEnvPaths ?? [];
    this.userDataPath = path.join(os.homedir(), 'Library', 'Application Support', this.appName);
    this.userEnvPath = path.join(this.userDataPath, '.env');
  }

  /**
   * Attempt to load environment variables from the known locations.
   * Prefers project .env files but falls back to user data storage.
   */
  loadEnv(extraPath?: string | null): void {
    const candidatePaths = [...this.baseEnvPaths];
    if (extraPath) {
      candidatePaths.push(extraPath);
    }

    let envLoaded = false;
    for (const envPath of candidatePaths) {
      if (!envPath || !fs.existsSync(envPath)) {
        continue;
      }
      const result = dotenv.config({ path: envPath });
      if (!result.error) {
        envLoaded = true;
        console.log(`[Main] Loaded .env from: ${envPath}`);
        break;
      }
    }

    const userKey = this.readUserApiKey();
    if (userKey) {
      process.env.OPENAI_API_KEY = userKey;
      envLoaded = true;
      console.log(`[Main] Loaded OpenAI API key from user data: ${this.userEnvPath}`);
    } else if (!envLoaded) {
      this.ensureUserEnvFile();
      console.warn(`[Main] No .env found. Created placeholder at: ${this.userEnvPath}`);
    }
  }

  getUserDataPath(): string {
    return this.userDataPath;
  }

  getUserEnvPath(): string {
    return this.userEnvPath;
  }

  getStatus(): ApiKeyStatus {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (key) {
      return {
        hasKey: true,
        maskedKey: this.maskKey(key),
      };
    }
    return { hasKey: false };
  }

  saveKey(rawKey: string): ApiKeyStatus {
    const apiKey = rawKey.trim();
    if (!apiKey) {
      throw new Error('API key cannot be empty');
    }

    this.ensureUserEnvFile();
    this.writeEnvValue(apiKey);
    process.env.OPENAI_API_KEY = apiKey;
    console.log('[Main] Saved OpenAI API key to user data');
    return this.getStatus();
  }

  deleteKey(): ApiKeyStatus {
    if (fs.existsSync(this.userEnvPath)) {
      this.writeEnvValue(null);
      console.log('[Main] Removed OpenAI API key from user data');
    }
    delete process.env.OPENAI_API_KEY;
    return { hasKey: false };
  }

  private ensureUserEnvFile(): void {
    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true });
    }
    if (!fs.existsSync(this.userEnvPath)) {
      fs.writeFileSync(this.userEnvPath, 'OPENAI_API_KEY=\n', { encoding: 'utf8', mode: 0o600 });
    }
  }

  private readUserApiKey(): string | null {
    if (!fs.existsSync(this.userEnvPath)) {
      return null;
    }
    const config = dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'));
    const value = config.OPENAI_API_KEY?.trim();
    return value ? value : null;
  }

  private writeEnvValue(value: string | null): void {
    const config = fs.existsSync(this.userEnvPath)
      ? dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'))
      : {};

    if (value) {
      config.OPENAI_API_KEY = value;
    } else {
      delete config.OPENAI_API_KEY;
    }

    const content = Object.entries(config)
      .map(([key, val]) => `${key}=${val}`)
      .join('\n');

    const finalContent = content ? `${content}\n` : '';
    fs.writeFileSync(this.userEnvPath, finalContent, { encoding: 'utf8', mode: 0o600 });
  }

  private maskKey(key: string): string {
    if (key.length <= 8) {
      return '*'.repeat(key.length);
    }
    const start = key.slice(0, 4);
    const end = key.slice(-4);
    return `${start}…${end}`;
  }
}
