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
    reason?: string; // Reason for the API call (for logging)
    timeoutMs?: number; // Timeout in milliseconds (default: 3 minutes)
  }
): Promise<T> {
  if (!llmClient) {
    return fallback();
  }

  const reason = options?.reason || 'API call';
  const timeoutMs = options?.timeoutMs ?? 180000; // Default: 3 minutes

  // Log why we're making this API call
  console.log(`[API Call] ${reason}`);

  const performRequest = async (): Promise<T> => {
    const startTime = Date.now();
    
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`API call timeout after ${timeoutMs}ms: ${reason}`));
        }, timeoutMs);
      });

      // Race between API call and timeout
      const content = await Promise.race([
        llmClient.chatCompletion(messages, {
          model: options?.model,
          maxTokens: options?.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
        }),
        timeoutPromise,
      ]) as string;

      const duration = Date.now() - startTime;
      console.log(`[API Call] Completed in ${duration}ms: ${reason}`);

      return content as unknown as T;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      // Check if it's a timeout error
      if (error?.message?.includes('timeout')) {
        console.warn(`[API Call] Timeout after ${duration}ms: ${reason}`);
        throw error; // Re-throw timeout so batch splitting can handle it
      }

      // Don't swallow token limit errors - let them propagate so batches can split
      const errorMessage = error?.message || String(error);
      // Extract nested error from various possible structures
      const nestedErrorRaw = error?.error?.metadata?.raw || 
                             error?.error?.message || 
                             error?.metadata?.raw ||
                             '';
      
      // Try to parse JSON from nested error if it's a string
      let parsedNestedError = '';
      let rawNestedError = nestedErrorRaw;
      try {
        if (typeof nestedErrorRaw === 'string' && nestedErrorRaw.trim().startsWith('{')) {
          const parsed = JSON.parse(nestedErrorRaw);
          parsedNestedError = parsed.error || parsed.message || parsedNestedError || nestedErrorRaw;
          rawNestedError = parsedNestedError;
        } else {
          parsedNestedError = nestedErrorRaw;
          rawNestedError = nestedErrorRaw;
        }
      } catch {
        parsedNestedError = nestedErrorRaw;
        rawNestedError = nestedErrorRaw;
      }
      
      // Combine all error text for detection
      const fullErrorText = `${errorMessage} ${parsedNestedError} ${rawNestedError}`.toLowerCase();
      
      const isTokenError = fullErrorText.includes('maximum context length') || 
                          fullErrorText.includes('maximum prompt length') ||
                          fullErrorText.includes('token') ||
                          (error?.status === 400 && (fullErrorText.includes('2000000') || fullErrorText.includes('context length')));
      
      // Check for invalid image errors (400 errors from vision API)
      // The error message contains: "Invalid request content: Downloaded response does not contain a valid JPG, PNG, or WebP image."
      // Also check for "does not contain a valid" which is the key phrase
      const isInvalidImageError = error?.status === 400 && (
        fullErrorText.includes('does not contain a valid') ||
        (fullErrorText.includes('invalid') && (
          fullErrorText.includes('image') || 
          fullErrorText.includes('jpg') || 
          fullErrorText.includes('jpeg') ||
          fullErrorText.includes('png') || 
          fullErrorText.includes('webp')
        ))
      );
      
      if (isTokenError) {
        console.warn(`[API Call] Token error after ${duration}ms: ${reason}`);
        // Re-throw token errors so batch splitting can handle them
        throw error;
      }
      
      // For invalid image errors and all other errors, just return fallback
      // This ensures batches complete with fallback results instead of hanging
      if (isInvalidImageError) {
        console.warn(`[API Call] Invalid image error detected after ${duration}ms: ${reason}`);
        console.warn(`[API Call] Error details: ${errorMessage} | ${parsedNestedError}`);
        // Return fallback instead of re-throwing - let processVisionBatch handle empty response
        return fallback();
      }
      
      // For other errors, log and fallback
      console.warn(`[API Call] Error after ${duration}ms: ${reason} - using fallback`);
      return fallback();
    }
  };

  if (workerPool) {
    return workerPool.execute(performRequest);
  }

  return performRequest();
}
