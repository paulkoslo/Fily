import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { WorkerPool } from './worker-pool';
import type { LLMClient } from './llm-client';

const DEFAULT_MAX_COMPLETION_TOKENS = 5000;

/**
 * Execute a chat completion request using the LLM client and shared worker pool.
 * Falls back to the provided fallback function if the client is unavailable or the call fails.
 * 
 * Supports both OpenRouter and OpenAI through the unified LLMClient interface.
 */
export async function executeApiCall<T>(
  messages: ChatCompletionMessageParam[],
  fallback: () => T,
  workerPool: WorkerPool | null,
  llmClient: LLMClient | null,
  options?: {
    model?: string;
    maxTokens?: number;
  }
): Promise<T> {
  if (!llmClient) {
    return fallback();
  }

  const performRequest = async (): Promise<T> => {
    try {
      const content = await llmClient.chatCompletion(messages, {
        model: options?.model,
        maxTokens: options?.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
      });

      return content as unknown as T;
    } catch (error) {
      console.error('[executeApiCall] Error during API call:', error);
      return fallback();
    }
  };

  if (workerPool) {
    return workerPool.execute(performRequest);
  }

  return performRequest();
}
