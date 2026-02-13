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
import type { WorkerPool } from '../worker-pool';
import { createLLMClient, type LLMClient } from '../llm-client';
import type { FileProcessingInput, FileProcessingResult } from './types';
import {
  SUMMARY_TAG_VISION_BATCH_SIZE,
  SUMMARY_TAG_TEXT_BATCH_SIZE,
  API_BATCH_TIMEOUT_MS,
} from '../../planner/constants';
import { chunk, groupFilesByProcessingType, reorderResults } from './helpers';
import { generateFallbackResult } from './fallback';
import { processVisionBatch, processTextBatch } from './batch-processor';
import { processSingleVision, processSingleText } from './file-processor';

/**
 * Combined Summary+Tag Agent
 * 
 * Generates both summary AND tags in a single API call per file/batch,
 * reducing API calls by ~97.5% while maintaining quality.
 * 
 * Features:
 * - Smart batching: Vision files (5-10 per batch), Text files (20-50 per batch)
 * - Token management: Limits each file to 500 words when batching
 * - Maintains same quality as separate agents (15-20 tags, max 200 char summary)
 * - Robust error handling with fallback to individual processing
 * 
 * Supports both OpenRouter and OpenAI through the unified LLMClient.
 */
export class SummaryTagAgent {
  // Batch sizes imported from constants
  private static readonly VISION_BATCH_SIZE = SUMMARY_TAG_VISION_BATCH_SIZE;
  private static readonly TEXT_BATCH_SIZE = SUMMARY_TAG_TEXT_BATCH_SIZE;

  private llmClient: LLMClient | null = null;
  private workerPool: WorkerPool | null = null;
  private onProgress?: (message: string) => void; // Optional progress callback
  private onBatchComplete?: (batchNumber: number, totalBatches: number, results: FileProcessingResult[]) => void; // Batch completion callback

  constructor(
    workerPool?: WorkerPool, 
    onProgress?: (message: string) => void,
    onBatchComplete?: (batchNumber: number, totalBatches: number, results: FileProcessingResult[]) => Promise<void>
  ) {
    this.llmClient = createLLMClient();
    this.workerPool = workerPool || null;
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

    // Add fallback results for invalid images immediately
    for (const invalidFile of invalidImages) {
      results.push(generateFallbackResult(invalidFile));
    }

    // Calculate batch counts
    const visionBatches = vision.length > 0 ? Math.ceil(vision.length / SummaryTagAgent.VISION_BATCH_SIZE) : 0;
    const textBatches = text.length > 0 ? Math.ceil(text.length / SummaryTagAgent.TEXT_BATCH_SIZE) : 0;
    const totalBatches = visionBatches + textBatches;

    // Process vision AND text batches IN PARALLEL - stream results as they complete!
    const allBatchPromises: Promise<{ type: 'vision' | 'text'; batchNumber: number; totalBatches: number; results: FileProcessingResult[] }>[] = [];
    const batchTaskPromises: Promise<FileProcessingResult[]>[] = []; // Track all submitted batch tasks
    let completedBatchCount = 0;

    // STEP 1: Submit ALL batches synchronously (no logging, no async work - just queue them)
    // Add vision batches
    if (vision.length > 0) {
      const visionBatchList = chunk(vision, SummaryTagAgent.VISION_BATCH_SIZE);
      visionBatchList.forEach((batch, index) => {
        const batchNumber = index + 1;
        // Submit to worker pool IMMEDIATELY (synchronously) - no logging, no async work
        const batchTaskPromise = this.workerPool?.execute(() => processVisionBatch(batch, this.llmClient, this.onProgress)) || Promise.resolve(processVisionBatch(batch, this.llmClient, this.onProgress));
        batchTaskPromises.push(batchTaskPromise);
        
        const promise = (async () => {
          const batchStartTime = Date.now();
          try {
            // Add per-batch timeout to prevent hanging
            const batchTimeout = API_BATCH_TIMEOUT_MS;
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Batch ${batchNumber} timeout after ${batchTimeout}ms`));
              }, batchTimeout);
            });

            // Wait for the batch task (already submitted to worker pool above)
            // Use the batchTaskPromise from the array (index matches batchNumber - 1 for vision)
            const taskPromise = batchTaskPromises[batchNumber - 1];
            const batchResults = await Promise.race([taskPromise, timeoutPromise]);
            
            completedBatchCount++;
            const duration = Date.now() - batchStartTime;
            
            // Log successful batch completion
            console.log(`[SummaryTagAgent] ✅ Vision batch ${batchNumber}/${totalBatches} completed successfully in ${duration}ms: ${batchResults.length} file(s) processed`);
            
            // Notify completion with actual batch number (order matters - this batch finished) - await DB writes
            await this.onBatchComplete?.(batchNumber, totalBatches, batchResults);
            
            return { type: 'vision' as const, batchNumber, totalBatches, results: batchResults };
          } catch (error) {
            // If batch fails completely or times out, generate fallback results for all files
            const duration = Date.now() - batchStartTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[SummaryTagAgent] ⚠️ Vision batch ${batchNumber}/${totalBatches} failed after ${duration}ms, using fallback results:`, errorMsg);
            this.onProgress?.(`Batch ${batchNumber} failed, using fallback results for ${batch.length} files`);
            
            const fallbackResults = batch.map(f => generateFallbackResult(f));
            completedBatchCount++;
            
            // Notify completion with fallback results
            await this.onBatchComplete?.(batchNumber, totalBatches, fallbackResults);
            
            return { type: 'vision' as const, batchNumber, totalBatches, results: fallbackResults };
          }
        })();
        allBatchPromises.push(promise);
      });
    }

    // Add text batches
    if (text.length > 0) {
      const textBatchList = chunk(text, SummaryTagAgent.TEXT_BATCH_SIZE);
      textBatchList.forEach((batch, index) => {
        const batchNumber = visionBatches + index + 1;
        // Submit to worker pool IMMEDIATELY (synchronously) - no logging, no async work
        const batchTaskPromise = this.workerPool?.execute(() => processTextBatch(batch, this.llmClient, this.onProgress)) || Promise.resolve(processTextBatch(batch, this.llmClient, this.onProgress));
        batchTaskPromises.push(batchTaskPromise);
        
        const promise = (async () => {
          const batchStartTime = Date.now();
          try {
            // Add per-batch timeout to prevent hanging
            const batchTimeout = API_BATCH_TIMEOUT_MS;
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Batch ${batchNumber} timeout after ${batchTimeout}ms`));
              }, batchTimeout);
            });

            // Wait for the batch task (already submitted to worker pool above)
            // Use the batchTaskPromise from the array (index is batchNumber - 1 for both vision and text)
            const taskPromise = batchTaskPromises[batchNumber - 1];
            const batchResults = await Promise.race([taskPromise, timeoutPromise]);
            
            completedBatchCount++;
            const duration = Date.now() - batchStartTime;
            
            // Log successful batch completion
            console.log(`[SummaryTagAgent] ✅ Text batch ${batchNumber}/${totalBatches} completed successfully in ${duration}ms: ${batchResults.length} file(s) processed`);
            
            // Notify completion with actual batch number (order matters - this batch finished) - await DB writes
            await this.onBatchComplete?.(batchNumber, totalBatches, batchResults);
            
            return { type: 'text' as const, batchNumber, totalBatches, results: batchResults };
          } catch (error) {
            // If batch fails completely or times out, generate fallback results for all files
            const duration = Date.now() - batchStartTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[SummaryTagAgent] ⚠️ Text batch ${batchNumber}/${totalBatches} failed after ${duration}ms, using fallback results:`, errorMsg);
            this.onProgress?.(`Batch ${batchNumber} failed, using fallback results for ${batch.length} files`);
            
            const fallbackResults = batch.map(f => generateFallbackResult(f));
            completedBatchCount++;
            
            // Notify completion with fallback results
            await this.onBatchComplete?.(batchNumber, totalBatches, fallbackResults);
            
            return { type: 'text' as const, batchNumber, totalBatches, results: fallbackResults };
          }
        })();
        allBatchPromises.push(promise);
      });
    }

    // STEP 2: All batches are now submitted! Log the final state
    if (this.workerPool) {
      const stats = this.workerPool.getStats();
      console.log(`[SummaryTagAgent] ✅ Submitted ${totalBatches} batches - WorkerPool: ${stats.active}/${stats.max} active, ${stats.queued} queued`);
    }
    this.onProgress?.(`Submitted ${totalBatches} batches to worker pool...`);

    // Wait for ALL batches (vision + text) to complete in parallel
    // Use allSettled so we don't hang if some batches fail or timeout
    console.log(`[SummaryTagAgent] Waiting for ${allBatchPromises.length} batches to complete...`);
    const allSettledResults = await Promise.allSettled(allBatchPromises);
    
    let fulfilledCount = 0;
    let rejectedCount = 0;
    
    for (let i = 0; i < allSettledResults.length; i++) {
      const settledResult = allSettledResults[i];
      if (settledResult.status === 'fulfilled') {
        fulfilledCount++;
        results.push(...settledResult.value.results);
      } else {
        rejectedCount++;
        // Batch failed - log and continue (shouldn't happen due to try-catch, but safety net)
        console.error(`[SummaryTagAgent] ⚠️ Batch promise ${i + 1} rejected (unexpected):`, settledResult.reason);
        // Generate fallback results for this batch (we don't know which batch it was, but we'll handle it)
      }
    }
    
    console.log(`[SummaryTagAgent] Batch processing complete: ${fulfilledCount} succeeded, ${rejectedCount} failed`);

    // CRITICAL: Wait for WorkerPool to finish all queued tasks before returning
    // This ensures extraction is truly complete before organization starts
    if (this.workerPool) {
      const stats = this.workerPool.getStats();
      if (stats.active > 0 || stats.queued > 0) {
        await this.workerPool.waitForCompletion();
      }
    }

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
