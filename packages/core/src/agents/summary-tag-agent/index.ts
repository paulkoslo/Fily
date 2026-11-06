/**
 * SummaryTagAgent - Main Orchestrator
 * 
 * Combined Summary+Tag Agent that generates both summary AND tags in a single API call.
 * Orchestrates parallel batch processing via WorkerPool for maximum efficiency.
 * 
 * Workflow Context:
 * - Entry point: processBatch() - called by ExtractionOrchestrator
 * - Groups files by type (vision vs text), chunks into batches, submits to WorkerPool
 * - Processes batches in parallel, handles timeouts/errors, reorders results
 * - Output: FileProcessingResult[] with summary + tags → stored in DB → used by TaxonomyAgent
 * 
 * This is the main class that coordinates all the helper modules (batch-processor, file-processor,
 * parsers, helpers, etc.) to efficiently process files and generate summaries/tags.
 */
import { WorkerPool } from '../worker-pool';
import { currentRequestSignal, withRequestDeadline } from '../request-context';
import { createLLMClient, type LLMClient } from '../llm-client';
import type { FileProcessingInput, FileProcessingResult } from './types';
import {
  SUMMARY_TAG_VISION_BATCH_SIZE,
  SUMMARY_TAG_TEXT_BATCH_SIZE,
  API_BATCH_TIMEOUT_MS,
} from '../../planner/constants';
import { chunk, groupFilesByProcessingType, reorderResults, isValidImage } from './helpers';
import { generateFallbackResult } from './fallback';
import { processVisionBatch, processTextBatch } from './batch-processor';

/**
 * Combined Summary+Tag Agent
 * 
 * Generates both summary AND tags in a single API call per file/batch,
 * batching supported files to reduce request overhead.
 * 
 * Features:
 * - Smart batching: Vision files (5-10 per batch), Text files (20-50 per batch)
 * - Token management: Limits each file to 500 words when batching
 * - Generates summaries and tags together (quality evaluation is still pending)
 * - Robust error handling with fallback to individual processing
 * 
 * Supports both OpenRouter and OpenAI through the unified LLMClient.
 */
export class SummaryTagAgent {
  // Batch sizes imported from constants
  private static readonly VISION_BATCH_SIZE = SUMMARY_TAG_VISION_BATCH_SIZE;
  private static readonly TEXT_BATCH_SIZE = SUMMARY_TAG_TEXT_BATCH_SIZE;

  private llmClient: LLMClient | null = null;
  private workerPool: WorkerPool;
  private onProgress?: (message: string) => void; // Optional progress callback
  private onBatchComplete?: (batchNumber: number, totalBatches: number, results: FileProcessingResult[]) => Promise<void>; // Batch completion callback

  constructor(
    workerPool?: WorkerPool, 
    onProgress?: (message: string) => void,
    onBatchComplete?: (batchNumber: number, totalBatches: number, results: FileProcessingResult[]) => Promise<void>
  ) {
    this.llmClient = createLLMClient();
    this.workerPool = workerPool ?? new WorkerPool();
    this.onProgress = onProgress;
    this.onBatchComplete = onBatchComplete;
  }

  /**
   * Process a batch of files, generating both summary and tags for each
   * 
   * BATCHING STRATEGY:
   * - Vision files (images): Processed in batches of VISION_BATCH_SIZE files
   * - Text files (PDF, DOCX, TXT, code, audio): Processed in batches of TEXT_BATCH_SIZE files
   * - Each file's content is truncated to MAX_WORDS_PER_FILE_IN_BATCH words max when building batch prompts
   * - Results are reordered to match input order
   */
  async processBatch(files: FileProcessingInput[]): Promise<FileProcessingResult[]> {
    if (files.length === 0) return [];

    const { vision, text, invalidImages } = groupFilesByProcessingType(files);
    const results: FileProcessingResult[] = [];

    const batches = [
      ...chunk(vision, SummaryTagAgent.VISION_BATCH_SIZE).map((batch) => ({ batch, type: 'vision' as const })),
      ...chunk(text, SummaryTagAgent.TEXT_BATCH_SIZE).map((batch) => ({ batch, type: 'text' as const })),
      ...chunk(invalidImages, SummaryTagAgent.VISION_BATCH_SIZE).map((batch) => ({ batch, type: 'invalid' as const })),
    ];
    const tasks = batches.map(({ batch, type }, index) => this.workerPool.execute(async () => {
      const batchNumber = index + 1;
      let batchResults: FileProcessingResult[];
      try {
        // Queue wait does not consume a batch's execution budget. Nested API
        // calls inherit this signal and abort when the batch deadline expires.
        batchResults = await withRequestDeadline(async () => {
          if (!this.llmClient || type === 'invalid') return batch.map(generateFallbackResult);
          if (type === 'text') return processTextBatch(batch, this.llmClient, this.onProgress);
          const hydrated: FileProcessingInput[] = [];
          const unavailable: FileProcessingResult[] = [];
          try {
            // Read only images in an active batch, and release each batch's
            // buffers before the worker admits more queued work.
            for (const file of batch) {
              const input = { ...file };
              if (!input.imageBuffer && input.loadImage) {
                try { input.imageBuffer = await input.loadImage(currentRequestSignal()); }
                catch (error) {
                  currentRequestSignal()?.throwIfAborted();
                  unavailable.push(generateFallbackResult(file));
                  continue;
                }
              }
              if (isValidImage(input)) hydrated.push(input);
              else unavailable.push(generateFallbackResult(file));
            }
            return [...await processVisionBatch(hydrated, this.llmClient, this.onProgress), ...unavailable];
          } finally {
            for (const input of hydrated) input.imageBuffer = undefined;
          }
        }, API_BATCH_TIMEOUT_MS, `Batch ${batchNumber}`);
      } catch (error) {
        const signal = currentRequestSignal();
        if (signal?.aborted) throw signal.reason;
        this.onProgress?.(`Batch ${batchNumber} failed, using fallback results for ${batch.length} files`);
        batchResults = batch.map(generateFallbackResult);
      }
      // Persistence is outside the inference fallback handler: a failed write
      // must propagate, rather than silently reporting a completed batch.
      await this.onBatchComplete?.(batchNumber, batches.length, batchResults);
      return batchResults;
    }));
    this.onProgress?.(`Submitted ${batches.length} batches to worker pool...`);
    const settled = await Promise.allSettled(tasks);
    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(...result.value);
    }
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;

    // Reorder results to match input order
    return reorderResults(results, files, generateFallbackResult);
  }

  /**
   * Process a single file (fallback or convenience method)
   */
  async processSingle(file: FileProcessingInput): Promise<FileProcessingResult> {
    const results = await this.processBatch([file]);
    return results[0] || generateFallbackResult(file);
  }
}

// Re-export types for convenience
export type { FileProcessingInput, FileProcessingResult } from './types';
