import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * LLM Provider configuration
 */
export type LLMProvider = 'openrouter' | 'openai';

export type LLMClientConfig = {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  /** Optional site URL for OpenRouter attribution */
  siteUrl?: string;
  /** Optional site name for OpenRouter attribution */
  siteName?: string;
};

/**
 * Available models for selection in the UI
 * These are OpenRouter model IDs (works for both OpenRouter and can be mapped for OpenAI)
 */
export const AVAILABLE_MODELS = [
  { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano (Fast & Cheap)', provider: 'OpenAI' },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini (Balanced)', provider: 'OpenAI' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', provider: 'xAI' },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', provider: 'DeepSeek' },
] as const;

export type AvailableModelId = (typeof AVAILABLE_MODELS)[number]['id'];

/**
 * Default models for each provider
 */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openrouter: 'openai/gpt-5-nano', // Cost-effective default for OpenRouter
  openai: 'gpt-5-nano',
};

/**
 * Map OpenRouter model ID to OpenAI native model ID (for direct OpenAI API usage)
 */
export function mapToOpenAIModel(openrouterModelId: string): string {
  // Strip the provider prefix for OpenAI native API
  if (openrouterModelId.startsWith('openai/')) {
    return openrouterModelId.replace('openai/', '');
  }
  // Non-OpenAI models can't be used with OpenAI API directly
  // Fall back to default
  return 'gpt-5-nano';
}

/**
 * LLM Client that supports both OpenRouter and OpenAI APIs
 * 
 * OpenRouter uses the same API format as OpenAI, just with a different base URL
 * and optional HTTP-Referer/X-Title headers for attribution.
 * 
 * Priority:
 * 1. OPENROUTER_API_KEY - Uses OpenRouter (allows model selection)
 * 2. OPENAI_API_KEY - Fallback to OpenAI
 */
export class LLMClient {
  private client: OpenAI;
  private provider: LLMProvider;
  private model: string;

  constructor(config: LLMClientConfig) {
    this.provider = config.provider;
    
    // Determine the model to use
    const configuredModel = config.model ?? DEFAULT_MODELS[config.provider];
    
    if (config.provider === 'openrouter') {
      // OpenRouter uses the full model ID (e.g., "openai/gpt-4.1-nano")
      this.model = configuredModel;
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.apiKey,
        defaultHeaders: {
          'HTTP-Referer': config.siteUrl ?? 'https://github.com/fily-app',
          'X-Title': config.siteName ?? 'Fily',
        },
      });
    } else {
      // OpenAI native API uses model names without provider prefix
      this.model = mapToOpenAIModel(configuredModel);
      this.client = new OpenAI({
        apiKey: config.apiKey,
      });
    }
  }

  /**
   * Get the underlying OpenAI client for direct API access
   * (e.g., for Whisper transcription which only works with OpenAI)
   */
  getOpenAIClient(): OpenAI {
    return this.client;
  }

  /**
   * Get the current provider
   */
  getProvider(): LLMProvider {
    return this.provider;
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Set the model to use for completions
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Create a chat completion
   */
  async chatCompletion(
    messages: ChatCompletionMessageParam[],
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    const modelToUse = options?.model ?? this.model;
    const provider = this.getProvider();
    
    try {
      console.log(`[LLMClient] Making API call - Provider: ${provider}, Model: ${modelToUse}, Messages: ${messages.length}`);
      
      const response = await this.client.chat.completions.create({
        model: modelToUse,
        messages,
        max_completion_tokens: options?.maxTokens ?? 5000,
        temperature: options?.temperature,
      });

      // CRITICAL: Log full response structure for debugging
      console.log(`[LLMClient] Response received - Type: ${typeof response}, Has choices: ${!!response.choices}, Choices type: ${Array.isArray(response.choices) ? 'array' : typeof response.choices}`);
      
      if (!response.choices) {
        console.error(`[LLMClient] ❌ Response has no choices property! Full response:`, JSON.stringify(response, null, 2));
        throw new Error(`API response missing 'choices' property. Response structure: ${JSON.stringify(Object.keys(response || {}))}`);
      }
      
      if (!Array.isArray(response.choices)) {
        console.error(`[LLMClient] ❌ Response.choices is not an array! Type: ${typeof response.choices}, Value:`, response.choices);
        throw new Error(`API response 'choices' is not an array. Type: ${typeof response.choices}`);
      }
      
      if (response.choices.length === 0) {
        console.error(`[LLMClient] ❌ Response.choices array is empty! Full response:`, JSON.stringify(response, null, 2));
        throw new Error('API response has empty choices array');
      }

      const content = response.choices[0]?.message?.content?.trim() ?? '';
      
      if (!content) {
        console.warn(
          `[LLMClient] Empty content in response. Choices: ${response.choices.length}, ` +
          `Finish reason: ${response.choices[0]?.finish_reason}, ` +
          `Model: ${modelToUse}, Provider: ${provider}`
        );
        console.warn(`[LLMClient] Full first choice:`, JSON.stringify(response.choices[0], null, 2));
      }
      
      return content;
    } catch (error) {
      console.error(`[LLMClient] Error in chatCompletion:`, error);
      throw error;
    }
  }
}

/**
 * Detect the best available LLM provider based on environment variables
 */
export function detectLLMProvider(): LLMClientConfig | null {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const configuredModel = process.env.LLM_MODEL?.trim();

  // Priority 1: OpenRouter (allows model selection)
  if (openrouterKey) {
    return {
      provider: 'openrouter',
      apiKey: openrouterKey,
      model: configuredModel ?? DEFAULT_MODELS.openrouter,
    };
  }

  // Priority 2: OpenAI (fallback)
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: configuredModel ?? DEFAULT_MODELS.openai,
    };
  }

  return null;
}

/**
 * Create an LLM client using environment variables
 * Returns null if no API key is available
 */
export function createLLMClient(): LLMClient | null {
  const config = detectLLMProvider();
  if (!config) {
    return null;
  }
  return new LLMClient(config);
}

/**
 * Get the provider name for logging
 */
export function getProviderDisplayName(provider: LLMProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter';
    case 'openai':
      return 'OpenAI';
    default:
      return provider;
  }
}
