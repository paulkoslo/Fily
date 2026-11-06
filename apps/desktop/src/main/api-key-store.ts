import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import { EncryptedCredentialStore, validateApiKey, writePrivateFile, type Credentials, type SecretCipher } from './credential-store';

export type ApiKeyType = 'openrouter' | 'openai';

export type ApiKeyStatus = {
  hasKey: boolean;
  maskedKey?: string;
  provider?: ApiKeyType;
};

export type MultiApiKeyStatus = {
  openrouter: ApiKeyStatus;
  openai: ApiKeyStatus;
  /** The active provider (priority: openrouter > openai) */
  activeProvider: ApiKeyType | null;
};

type ApiKeyStoreOptions = {
  appName?: string;
  baseEnvPaths?: string[];
  /** Override for isolated development/test profiles. */
  userDataPath?: string;
  cipher?: SecretCipher;
};

export class ApiKeyStore {
  private readonly appName: string;
  private readonly baseEnvPaths: string[];
  private readonly userDataPath: string;
  private readonly userEnvPath: string;
  private readonly credentials: EncryptedCredentialStore;
  private storageError: string | null = null;

  constructor(options: ApiKeyStoreOptions = {}) {
    this.appName = options.appName ?? 'Fily';
    this.baseEnvPaths = options.baseEnvPaths ?? [];
    this.userDataPath = options.userDataPath ?? path.join(os.homedir(), 'Library', 'Application Support', this.appName);
    this.userEnvPath = path.join(this.userDataPath, '.env');
    this.credentials = new EncryptedCredentialStore(this.userDataPath, options.cipher);
  }

  /**
   * Load explicit developer settings, then migrate and load stored credentials.
   * Stored provider keys override environment values. Call after Electron is ready.
   */
  loadEnv(extraPath?: string | null): void {
    this.storageError = null;
    try {
      // Explicit developer environment files remain externally managed. Never
      // modify them or load unrelated environment settings into the main process.
      for (const envPath of [...this.baseEnvPaths, ...(extraPath ? [extraPath] : [])]) {
        if (!fs.existsSync(envPath)) continue;
        // A working-directory or symlink alias must not bypass migration and
        // load the legacy private file as an explicit developer environment.
        if (fs.existsSync(this.userEnvPath) &&
            fs.realpathSync.native(envPath) === fs.realpathSync.native(this.userEnvPath)) continue;
        const config = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
        for (const key of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'] as const) {
          if (!process.env[key] && config[key]) process.env[key] = validateApiKey(config[key]);
        }
        if (!process.env.LLM_MODEL && config.LLM_MODEL) process.env.LLM_MODEL = config.LLM_MODEL;
        break;
      }
      const keys = this.migrateLegacyKeys();
      if (keys.openrouter) process.env.OPENROUTER_API_KEY = keys.openrouter;
      if (keys.openai) process.env.OPENAI_API_KEY = keys.openai;
      if (!process.env.LLM_MODEL) {
        const model = this.getLLMModel();
        if (model) process.env.LLM_MODEL = model;
      }
    } catch (error) {
      this.storageError = error instanceof Error ? error.message : 'Credential storage is unavailable';
      console.warn('[Main] Credential storage unavailable; existing files were preserved.');
    }
  }

  /**
   * Get the currently active LLM provider based on available keys
   * Priority: OpenRouter > OpenAI
   */
  getActiveProvider(): ApiKeyType | null {
    if (process.env.OPENROUTER_API_KEY?.trim()) {
      return 'openrouter';
    }
    if (process.env.OPENAI_API_KEY?.trim()) {
      return 'openai';
    }
    return null;
  }

  getUserDataPath(): string {
    return this.userDataPath;
  }

  getUserEnvPath(): string {
    return this.userEnvPath;
  }

  getStorageError(): string | null {
    return this.storageError;
  }

  /**
   * Get status of the primary (OpenAI) key - for backwards compatibility
   */
  getStatus(): ApiKeyStatus {
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    
    // Return the active provider's status
    if (openrouterKey) {
      return {
        hasKey: true,
        maskedKey: this.maskKey(openrouterKey),
        provider: 'openrouter',
      };
    }
    if (openaiKey) {
      return {
        hasKey: true,
        maskedKey: this.maskKey(openaiKey),
        provider: 'openai',
      };
    }
    return { hasKey: false };
  }

  /**
   * Get status of all API keys
   */
  getMultiStatus(): MultiApiKeyStatus {
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();

    return {
      openrouter: openrouterKey
        ? { hasKey: true, maskedKey: this.maskKey(openrouterKey), provider: 'openrouter' }
        : { hasKey: false },
      openai: openaiKey
        ? { hasKey: true, maskedKey: this.maskKey(openaiKey), provider: 'openai' }
        : { hasKey: false },
      activeProvider: this.getActiveProvider(),
    };
  }

  /**
   * Save an API key for a specific provider
   */
  saveKey(rawKey: string, keyType: ApiKeyType = 'openai'): ApiKeyStatus {
    const apiKey = validateApiKey(rawKey);
    const keys = this.migrateLegacyKeys();
    keys[keyType] = apiKey;
    this.credentials.write(keys);
    this.storageError = null;
    
    if (keyType === 'openrouter') {
      process.env.OPENROUTER_API_KEY = apiKey;
      console.log('[Main] Saved OpenRouter API key to user data');
    } else {
      process.env.OPENAI_API_KEY = apiKey;
      console.log('[Main] Saved OpenAI API key to user data');
    }
    
    return this.getStatus();
  }

  /**
   * Delete an API key for a specific provider
   */
  deleteKey(keyType: ApiKeyType = 'openai'): ApiKeyStatus {
    const keys = this.migrateLegacyKeys();
    delete keys[keyType];
    this.credentials.write(keys);
    this.storageError = null;
    
    if (keyType === 'openrouter') {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    
    return this.getStatus();
  }

  /**
   * Delete all API keys
   */
  deleteAllKeys(): MultiApiKeyStatus {
    this.deleteKey('openrouter');
    this.deleteKey('openai');
    return this.getMultiStatus();
  }

  // ============================================================================
  // LLM Model Management
  // ============================================================================

  /**
   * Get the currently configured LLM model
   */
  getLLMModel(): string | null {
    // First check env var, then user config
    const envModel = process.env.LLM_MODEL?.trim();
    if (envModel) {
      return envModel;
    }
    
    if (!fs.existsSync(this.userEnvPath)) {
      return null;
    }
    
    const config = dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'));
    return config.LLM_MODEL?.trim() || null;
  }

  /**
   * Save the LLM model configuration
   */
  saveLLMModel(model: string): string {
    this.migrateLegacyKeys();
    
    const config = fs.existsSync(this.userEnvPath)
      ? dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'))
      : {};

    config.LLM_MODEL = model;

    const content = Object.entries(config)
      .map(([key, val]) => `${key}=${JSON.stringify(val)}`)
      .join('\n');

    writePrivateFile(this.userEnvPath, `${content}\n`);
    process.env.LLM_MODEL = model;
    console.log(`[Main] Saved LLM model: ${model}`);
    
    return model;
  }

  private migrateLegacyKeys(): Credentials {
    const config = fs.existsSync(this.userEnvPath)
      ? dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8')) : {};
    const stored = this.credentials.read();
    const legacy: Credentials = {};
    if (config.OPENROUTER_API_KEY?.trim()) legacy.openrouter = validateApiKey(config.OPENROUTER_API_KEY);
    if (config.OPENAI_API_KEY?.trim()) legacy.openai = validateApiKey(config.OPENAI_API_KEY);
    const keys = { ...legacy, ...stored };
    if (Object.keys(legacy).length > 0) {
      this.credentials.write(keys);
      const verified = this.credentials.read();
      if (verified.openrouter !== keys.openrouter || verified.openai !== keys.openai) {
        throw new Error('Credential migration could not be verified; legacy configuration was preserved.');
      }
    }
    if ('OPENROUTER_API_KEY' in config || 'OPENAI_API_KEY' in config) {
      delete config.OPENROUTER_API_KEY;
      delete config.OPENAI_API_KEY;
      const content = Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
      writePrivateFile(this.userEnvPath, content + '\n');
    }
    return keys;
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
