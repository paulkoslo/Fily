import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

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
   * Loads both OpenRouter and OpenAI keys if available.
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

    // Load user-stored keys (these can override .env values)
    const userKeys = this.readUserApiKeys();
    
    if (userKeys.openrouter) {
      process.env.OPENROUTER_API_KEY = userKeys.openrouter;
      envLoaded = true;
      console.log(`[Main] Loaded OpenRouter API key from user data: ${this.userEnvPath}`);
    }
    
    if (userKeys.openai) {
      process.env.OPENAI_API_KEY = userKeys.openai;
      envLoaded = true;
      console.log(`[Main] Loaded OpenAI API key from user data: ${this.userEnvPath}`);
    }
    
    if (!envLoaded) {
      this.ensureUserEnvFile();
      console.warn(`[Main] No .env found. Created placeholder at: ${this.userEnvPath}`);
    }

    // Load LLM model from user config if not set via env
    if (!process.env.LLM_MODEL) {
      const userModel = this.getLLMModel();
      if (userModel) {
        process.env.LLM_MODEL = userModel;
        console.log(`[Main] Loaded LLM model from user data: ${userModel}`);
      }
    }

    // Log which provider will be active
    const activeProvider = this.getActiveProvider();
    if (activeProvider) {
      console.log(`[Main] Active LLM provider: ${activeProvider}`);
    }
    
    const model = process.env.LLM_MODEL;
    if (model) {
      console.log(`[Main] LLM model: ${model}`);
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
    const apiKey = rawKey.trim();
    if (!apiKey) {
      throw new Error('API key cannot be empty');
    }

    this.ensureUserEnvFile();
    this.writeEnvValue(apiKey, keyType);
    
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
    if (fs.existsSync(this.userEnvPath)) {
      this.writeEnvValue(null, keyType);
      console.log(`[Main] Removed ${keyType === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API key from user data`);
    }
    
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
    this.ensureUserEnvFile();
    
    const config = fs.existsSync(this.userEnvPath)
      ? dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'))
      : {};

    config.LLM_MODEL = model;
    process.env.LLM_MODEL = model;

    const content = Object.entries(config)
      .map(([key, val]) => `${key}=${val}`)
      .join('\n');

    fs.writeFileSync(this.userEnvPath, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`[Main] Saved LLM model: ${model}`);
    
    return model;
  }

  private ensureUserEnvFile(): void {
    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true });
    }
    if (!fs.existsSync(this.userEnvPath)) {
      fs.writeFileSync(
        this.userEnvPath,
        '# Fily API Keys\n# Priority: OPENROUTER_API_KEY > OPENAI_API_KEY\nOPENROUTER_API_KEY=\nOPENAI_API_KEY=\n',
        { encoding: 'utf8', mode: 0o600 }
      );
    }
  }

  /**
   * Read all user API keys from the env file
   */
  private readUserApiKeys(): { openrouter: string | null; openai: string | null } {
    if (!fs.existsSync(this.userEnvPath)) {
      return { openrouter: null, openai: null };
    }
    const config = dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'));
    return {
      openrouter: config.OPENROUTER_API_KEY?.trim() || null,
      openai: config.OPENAI_API_KEY?.trim() || null,
    };
  }

  private writeEnvValue(value: string | null, keyType: ApiKeyType = 'openai'): void {
    const config = fs.existsSync(this.userEnvPath)
      ? dotenv.parse(fs.readFileSync(this.userEnvPath, 'utf8'))
      : {};

    const envKey = keyType === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
    
    if (value) {
      config[envKey] = value;
    } else {
      delete config[envKey];
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
