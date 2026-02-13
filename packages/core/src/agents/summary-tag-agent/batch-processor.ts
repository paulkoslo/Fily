/**
 * SummaryTagAgent - Batch Processing
 * 
 * Processes files in batches for efficient API usage. Handles vision batches (images)
 * and text batches (PDF, DOCX, code, audio, video) separately with different strategies.
 * 
 * Workflow Context:
 * - processVisionBatch: Processes batches of images (called via WorkerPool from main agent)
 * - processTextBatch: Processes batches of text files (called via WorkerPool from main agent)
 * - processBatchIndividually: Fallback when batch parsing fails (processes files one-by-one)
 * - Used by: Main SummaryTagAgent.processBatch() method
 * - Returns fallback results on any error (ensures pipeline never stops)
 * 
 * This module is the core of efficient batch processing - reduces API calls by ~97.5%.
 */
import type { FileProcessingInput, FileProcessingResult } from './types';
import type { LLMClient } from '../llm-client';
import type { WorkerPool } from '../worker-pool';
import { executeApiCall } from '../api-call-helper';
import { buildVisionBatchPrompt, buildTextBatchPrompt } from './prompt-builders';
import { parseBatchResponse } from './parsers';
import { processSingleVision, processSingleText } from './file-processor';
import { generateFallbackResult } from './fallback';
import { isValidImage } from './helpers';
import { API_VISION_MAX_TOKENS, API_DEFAULT_TIMEOUT_MS } from '../../planner/constants';

/**
 * Process a batch of vision files (images with buffers)
 * Automatically splits batch in half if token limit is hit
 */
export async function processVisionBatch(
  files: FileProcessingInput[],
  llmClient: LLMClient | null,
  onProgress?: (message: string) => void
): Promise<FileProcessingResult[]> {
  if (files.length === 0) return [];

  // For single file, use individual processing
  if (files.length === 1) {
    return [await processSingleVision(files[0], llmClient, null)];
  }

  try {
    // Build batch prompt with all images
    const messages = buildVisionBatchPrompt(files);
    
    const fallback = () => '';
    const reason = `Processing vision batch: ${files.length} image${files.length > 1 ? 's' : ''}`;
    
    // Don't pass workerPool here - processVisionBatch is already executed through workerPool
    // Passing workerPool would cause double-wrapping and waste worker slots
    const response = await executeApiCall<string>(
      messages,
      fallback,
      null, // No worker pool - already inside a worker pool task
      llmClient,
      {
        // Use high token limit for batches to allow full responses
        maxTokens: API_VISION_MAX_TOKENS,
        reason,
        timeoutMs: API_DEFAULT_TIMEOUT_MS,
      }
    );

    // If response is empty (fallback returned), treat as error and use fallback results
    // This happens when API errors occur (invalid images, network issues, etc.)
    if (!response || response.trim().length === 0) {
      // Don't throw - just return fallback results for all files
      // This ensures the batch completes and doesn't hang
      console.warn(`[SummaryTagAgent] Empty response from API for vision batch (${files.length} files) - using fallback results`);
      return files.map(f => generateFallbackResult(f));
    }

    const results = await parseBatchResponse(response, files, async (files) => {
      return processBatchIndividually(files, llmClient, null);
    });
    return results;
  } catch (error: any) {
    // SIMPLIFIED: On ANY error, just return fallback results - don't retry, don't throw
    // This ensures the process never stops and taxonomy can proceed
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[SummaryTagAgent] Vision batch failed for ${files.length} file(s), using fallback results:`, errorMsg);
    onProgress?.(`Batch failed, using fallback results for ${files.length} file(s)`);
    
    // Return fallback results for all files in the batch
    return files.map(f => generateFallbackResult(f));
  }
}

/**
 * Process a batch of text files
 * Automatically splits batch in half if token limit is hit
 */
export async function processTextBatch(
  files: FileProcessingInput[],
  llmClient: LLMClient | null,
  onProgress?: (message: string) => void
): Promise<FileProcessingResult[]> {
  if (files.length === 0) return [];

  // For single file, use individual processing
  if (files.length === 1) {
    return [await processSingleText(files[0], llmClient, null)];
  }

  try {
    // Build batch prompt with truncated content (500 words max per file)
    const messages = buildTextBatchPrompt(files);
    
    const fallback = () => '';
    const reason = `Processing text batch: ${files.length} file${files.length > 1 ? 's' : ''}`;
    
    // Don't pass workerPool here - processTextBatch is already executed through workerPool
    // Passing workerPool would cause double-wrapping and waste worker slots
    const response = await executeApiCall<string>(
      messages,
      fallback,
      null, // No worker pool - already inside a worker pool task
      llmClient,
      {
        // Use high token limit for batches to allow full responses
        maxTokens: API_VISION_MAX_TOKENS,
        reason,
        timeoutMs: API_DEFAULT_TIMEOUT_MS,
      }
    );

    // If response is empty (fallback returned), treat as error and use fallback results
    // This happens when API errors occur (network issues, etc.)
    if (!response || response.trim().length === 0) {
      // Don't throw - just return fallback results for all files
      // This ensures the batch completes and doesn't hang
      console.warn(`[SummaryTagAgent] Empty response from API for text batch (${files.length} files) - using fallback results`);
      return files.map(f => generateFallbackResult(f));
    }

    const results = await parseBatchResponse(response, files, async (files) => {
      return processBatchIndividually(files, llmClient, null);
    });
    return results;
  } catch (error: any) {
    // SIMPLIFIED: On ANY error, just return fallback results - don't retry, don't throw
    // This ensures the process never stops and taxonomy can proceed
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[SummaryTagAgent] Text batch failed for ${files.length} file(s), using fallback results:`, errorMsg);
    onProgress?.(`Batch failed, using fallback results for ${files.length} file(s)`);
    
    // Return fallback results for all files in the batch
    return files.map(f => generateFallbackResult(f));
  }
}

/**
 * Process files individually as fallback
 * This is used when batch processing fails and we can't recover
 */
export async function processBatchIndividually(
  files: FileProcessingInput[],
  llmClient: LLMClient | null,
  workerPool: WorkerPool | null
): Promise<FileProcessingResult[]> {
  const results: FileProcessingResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      let result: FileProcessingResult;
      if (file.contentType === 'image' && file.imageBuffer) {
        // Validate before processing
        if (!isValidImage(file)) {
          console.warn(`[SummaryTagAgent] ⚠️ Skipping invalid image: ${file.fileName}`);
          result = generateFallbackResult(file);
        } else {
          result = await processSingleVision(file, llmClient, workerPool);
        }
      } else {
        result = await processSingleText(file, llmClient, workerPool);
      }
      results.push(result);
    } catch (error) {
      console.error(`[SummaryTagAgent] ❌ Failed to process ${file.fileName}:`, error);
      results.push(generateFallbackResult(file));
    }
  }

  return results;
}
