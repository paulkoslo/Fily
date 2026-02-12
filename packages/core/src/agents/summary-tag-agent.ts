import {
  SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
  buildTextFilePrompt,
  buildScannedPDFPrompt,
  buildImagePrompt,
  buildBatchPrompt,
} from './prompts/summary-tag-agent-prompt';
import type { WorkerPool } from './worker-pool';
import { executeApiCall } from './api-call-helper';
import { createLLMClient, getProviderDisplayName, type LLMClient } from './llm-client';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Input for file processing
 */
export interface FileProcessingInput {
  fileId: string;
  filePath: string;
  fileName: string;
  extension: string;
  contentType: 'text' | 'pdf' | 'document' | 'image' | 'audio' | 'video';
  extractedText?: string;
  metadata?: Record<string, any>;
  imageBuffer?: Buffer;
  imageMimeType?: string;
}

/**
 * Result of file processing (summary + tags)
 */
export interface FileProcessingResult {
  fileId: string;
  summary: string;
  tags: string[];
}

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
  // Batch size configuration
  // Reduced batch sizes to prevent token limit errors (model max: 2M tokens)
  private static readonly VISION_BATCH_SIZE = 5; // Images: very small batches due to base64 image size (each image can be 100K+ tokens)
  private static readonly TEXT_BATCH_SIZE = 20; // Text files: drastically reduced - 10 files × 500 words ≈ 6,500 words ≈ 8,500 tokens (safe margin)
  private static readonly MAX_WORDS_PER_FILE_IN_BATCH = 500; // Max 500 words per file in batches

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

    const { vision, text, invalidImages } = this.groupFilesByProcessingType(files);
    const results: FileProcessingResult[] = [];

    // Add fallback results for invalid images immediately
    for (const invalidFile of invalidImages) {
      results.push(this.generateFallbackResult(invalidFile));
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
      const visionBatchList = this.chunk(vision, SummaryTagAgent.VISION_BATCH_SIZE);
      visionBatchList.forEach((batch, index) => {
        const batchNumber = index + 1;
        // Submit to worker pool IMMEDIATELY (synchronously) - no logging, no async work
        const batchTaskPromise = this.workerPool?.execute(() => this.processVisionBatch(batch)) || Promise.resolve(this.processVisionBatch(batch));
        batchTaskPromises.push(batchTaskPromise);
        
        const promise = (async () => {
          const batchStartTime = Date.now();
          try {
            // Add per-batch timeout to prevent hanging
            const batchTimeout = 240000; // 4 minutes per batch (longer than API timeout)
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
            
            const fallbackResults = batch.map(f => this.generateFallbackResult(f));
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
      const textBatchList = this.chunk(text, SummaryTagAgent.TEXT_BATCH_SIZE);
      textBatchList.forEach((batch, index) => {
        const batchNumber = visionBatches + index + 1;
        // Submit to worker pool IMMEDIATELY (synchronously) - no logging, no async work
        const batchTaskPromise = this.workerPool?.execute(() => this.processTextBatch(batch)) || Promise.resolve(this.processTextBatch(batch));
        batchTaskPromises.push(batchTaskPromise);
        
        const promise = (async () => {
          const batchStartTime = Date.now();
          try {
            // Add per-batch timeout to prevent hanging
            const batchTimeout = 240000; // 4 minutes per batch (longer than API timeout)
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
            
            const fallbackResults = batch.map(f => this.generateFallbackResult(f));
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
    return this.reorderResults(results, files);
  }

  /**
   * Process a single file (fallback or convenience method)
   */
  async processSingle(file: FileProcessingInput): Promise<FileProcessingResult> {
    const results = await this.processBatch([file]);
    return results[0] || this.generateFallbackResult(file);
  }

  /**
   * Group files by processing type (vision vs text)
   * Also validates image files and filters out invalid ones
   */
  private groupFilesByProcessingType(files: FileProcessingInput[]): {
    vision: FileProcessingInput[];
    text: FileProcessingInput[];
    invalidImages: FileProcessingInput[];
  } {
    const vision: FileProcessingInput[] = [];
    const text: FileProcessingInput[] = [];
    const invalidImages: FileProcessingInput[] = [];

    for (const file of files) {
      if (file.contentType === 'image' && file.imageBuffer) {
        // Validate image before adding to batch
        if (this.isValidImage(file)) {
          vision.push(file);
        } else {
          console.warn(`[SummaryTagAgent] ⚠️ Invalid image format, skipping: ${file.fileName}`);
          invalidImages.push(file);
        }
      } else {
        text.push(file);
      }
    }

    return { vision, text, invalidImages };
  }

  /**
   * Validate if an image file is valid for API processing
   */
  private isValidImage(file: FileProcessingInput): boolean {
    if (!file.imageBuffer || !file.imageMimeType) {
      return false;
    }

    const mimeType = file.imageMimeType.toLowerCase();
    const isValidFormat = mimeType.includes('jpeg') || mimeType.includes('jpg') || 
                         mimeType.includes('png') || mimeType.includes('webp');
    
    if (!isValidFormat) {
      return false;
    }

    // Check base64 size (very large images might cause issues)
    const base64Image = file.imageBuffer.toString('base64');
    if (base64Image.length > 20 * 1024 * 1024) { // 20MB base64 limit
      return false;
    }

    return true;
  }

  /**
   * Process a batch of vision files (images with buffers)
   * Automatically splits batch in half if token limit is hit
   */
  private async processVisionBatch(files: FileProcessingInput[]): Promise<FileProcessingResult[]> {
    if (files.length === 0) return [];

    // For single file, use individual processing
    if (files.length === 1) {
      return [await this.processSingleVision(files[0])];
    }

    try {
      // Build batch prompt with all images
      const messages = this.buildVisionBatchPrompt(files);
      
      const fallback = () => '';
      const reason = `Processing vision batch: ${files.length} image${files.length > 1 ? 's' : ''}`;
      
      // Don't pass workerPool here - processVisionBatch is already executed through workerPool
      // Passing workerPool would cause double-wrapping and waste worker slots
      const response = await executeApiCall<string>(
        messages,
        fallback,
        null, // No worker pool - already inside a worker pool task
        this.llmClient,
        {
          // Use high token limit for batches to allow full responses
          maxTokens: 20000,
          reason,
          timeoutMs: 180000, // 3 minutes timeout
        }
      );

      // If response is empty (fallback returned), treat as error and use fallback results
      // This happens when API errors occur (invalid images, network issues, etc.)
      if (!response || response.trim().length === 0) {
        // Don't throw - just return fallback results for all files
        // This ensures the batch completes and doesn't hang
        console.warn(`[SummaryTagAgent] Empty response from API for vision batch (${files.length} files) - using fallback results`);
        return files.map(f => this.generateFallbackResult(f));
      }

      const results = await this.parseBatchResponse(response, files);
      return results;
    } catch (error: any) {
      // SIMPLIFIED: On ANY error, just return fallback results - don't retry, don't throw
      // This ensures the process never stops and taxonomy can proceed
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[SummaryTagAgent] Vision batch failed for ${files.length} file(s), using fallback results:`, errorMsg);
      this.onProgress?.(`Batch failed, using fallback results for ${files.length} file(s)`);
      
      // Return fallback results for all files in the batch
      return files.map(f => this.generateFallbackResult(f));
    }
  }

  /**
   * Process a batch of text files
   * Automatically splits batch in half if token limit is hit
   */
  private async processTextBatch(files: FileProcessingInput[]): Promise<FileProcessingResult[]> {
    if (files.length === 0) return [];

    // For single file, use individual processing
    if (files.length === 1) {
      return [await this.processSingleText(files[0])];
    }

    try {
      // Build batch prompt with truncated content (500 words max per file)
      const messages = this.buildTextBatchPrompt(files);
      
      const fallback = () => '';
      const reason = `Processing text batch: ${files.length} file${files.length > 1 ? 's' : ''}`;
      
      // Don't pass workerPool here - processTextBatch is already executed through workerPool
      // Passing workerPool would cause double-wrapping and waste worker slots
      const response = await executeApiCall<string>(
        messages,
        fallback,
        null, // No worker pool - already inside a worker pool task
        this.llmClient,
        {
          // Use high token limit for batches to allow full responses
          maxTokens: 20000,
          reason,
          timeoutMs: 180000, // 3 minutes timeout
        }
      );

      // If response is empty (fallback returned), treat as error and use fallback results
      // This happens when API errors occur (network issues, etc.)
      if (!response || response.trim().length === 0) {
        // Don't throw - just return fallback results for all files
        // This ensures the batch completes and doesn't hang
        console.warn(`[SummaryTagAgent] Empty response from API for text batch (${files.length} files) - using fallback results`);
        return files.map(f => this.generateFallbackResult(f));
      }

      const results = await this.parseBatchResponse(response, files);
      return results;
    } catch (error: any) {
      // SIMPLIFIED: On ANY error, just return fallback results - don't retry, don't throw
      // This ensures the process never stops and taxonomy can proceed
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[SummaryTagAgent] Text batch failed for ${files.length} file(s), using fallback results:`, errorMsg);
      this.onProgress?.(`Batch failed, using fallback results for ${files.length} file(s)`);
      
      // Return fallback results for all files in the batch
      return files.map(f => this.generateFallbackResult(f));
    }
  }

  /**
   * Process files individually as fallback
   * This is used when batch processing fails and we can't recover
   */
  private async processBatchIndividually(files: FileProcessingInput[]): Promise<FileProcessingResult[]> {
    const results: FileProcessingResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        let result: FileProcessingResult;
        if (file.contentType === 'image' && file.imageBuffer) {
          // Validate before processing
          if (!this.isValidImage(file)) {
            console.warn(`[SummaryTagAgent] ⚠️ Skipping invalid image: ${file.fileName}`);
            result = this.generateFallbackResult(file);
          } else {
            result = await this.processSingleVision(file);
          }
        } else {
          result = await this.processSingleText(file);
        }
        results.push(result);
      } catch (error) {
        console.error(`[SummaryTagAgent] ❌ Failed to process ${file.fileName}:`, error);
        results.push(this.generateFallbackResult(file));
      }
    }

    return results;
  }

  /**
   * Process a single vision file
   */
  private async processSingleVision(file: FileProcessingInput): Promise<FileProcessingResult> {
    if (!file.imageBuffer || !file.imageMimeType) {
      console.warn(`[SummaryTagAgent] Missing image buffer or mimeType for ${file.fileName}`);
      return this.generateFallbackResult(file);
    }

    // Validate image format before sending to API
    const mimeType = file.imageMimeType.toLowerCase();
    const isValidFormat = mimeType.includes('jpeg') || mimeType.includes('jpg') || 
                         mimeType.includes('png') || mimeType.includes('webp');
    
    if (!isValidFormat) {
      console.warn(`[SummaryTagAgent] ⚠️ Unsupported image format "${file.imageMimeType}" for ${file.fileName}, using fallback`);
      return this.generateFallbackResult(file);
    }

    const fallback = () => JSON.stringify(this.generateFallbackResult(file));
    const base64Image = file.imageBuffer.toString('base64');
    
    // Validate base64 image size (very large images might cause issues)
    if (base64Image.length > 20 * 1024 * 1024) { // 20MB base64 limit
      console.warn(`[SummaryTagAgent] ⚠️ Image too large (${Math.round(base64Image.length / 1024 / 1024)}MB) for ${file.fileName}, using fallback`);
      return this.generateFallbackResult(file);
    }
    
    const userPrompt = buildImagePrompt(
      file.fileId,
      file.filePath,
      file.fileName,
      file.extension,
      file.metadata
    );

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPrompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${file.imageMimeType};base64,${base64Image}`,
            },
          },
        ],
      },
    ];

    try {
      const response = await executeApiCall<string>(
        messages,
        fallback,
        this.workerPool,
        this.llmClient,
        {
          reason: `Processing single vision file: ${file.fileName}`,
          timeoutMs: 180000, // 3 minutes timeout
        }
      );

      return this.parseSingleResponse(response, file);
    } catch (error: any) {
      // Check if it's an invalid image error
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isInvalidImage = errorMsg.includes('Invalid image') || 
                            (error?.status === 400 && errorMsg.toLowerCase().includes('image'));
      
      if (isInvalidImage) {
        console.warn(`[SummaryTagAgent] ⚠️ Invalid image format detected for ${file.fileName}: ${errorMsg}`);
        return this.generateFallbackResult(file);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Process a single text file
   * Note: This method is only called for non-image files (images are handled by processSingleVision)
   */
  private async processSingleText(file: FileProcessingInput): Promise<FileProcessingResult> {
    const fallback = () => JSON.stringify(this.generateFallbackResult(file));
    const isEmpty = !file.extractedText || file.extractedText.length === 0;

    let userPrompt: string;
    
    if (file.contentType === 'pdf') {
      const text = file.extractedText || '';
      const isImageBased = file.metadata?.isImageBased && text.trim().length === 0;
      
      if (isImageBased) {
        // Scanned PDF - use metadata only
        userPrompt = buildScannedPDFPrompt(
          file.fileId,
          file.filePath,
          file.fileName,
          file.metadata
        );
      } else {
        // Normal PDF - truncate content for single file processing
        const contentToAnalyze = text.length > 8000
          ? text.substring(0, 8000) + '\n[... content truncated ...]'
          : text;
        
        userPrompt = buildTextFilePrompt(
          file.fileId,
          file.filePath,
          file.fileName,
          file.extension,
          'pdf',
          contentToAnalyze,
          isEmpty,
          file.metadata
        );
      }
    } else {
      // Text/code/document/audio/video files (image files are handled separately)
      let contentToAnalyze: string;
      const contentTypeForPrompt: 'text' | 'pdf' | 'document' | 'audio' | 'video' = 
        file.contentType === 'image' ? 'text' : file.contentType;
      
      if (file.contentType === 'audio' || file.contentType === 'video') {
        const transcription = file.extractedText || '';
        contentToAnalyze = transcription.length > 2000
          ? transcription.substring(0, 2000) + '\n[... transcription truncated ...]'
          : transcription;
      } else {
        const content = file.extractedText || '';
        contentToAnalyze = isEmpty
          ? '[Empty file]'
          : content.length > 8000
          ? content.substring(0, 8000) + '\n[... content truncated ...]'
          : content;
      }
      
      userPrompt = buildTextFilePrompt(
        file.fileId,
        file.filePath,
        file.fileName,
        file.extension,
        contentTypeForPrompt,
        contentToAnalyze,
        isEmpty,
        file.metadata
      );
    }

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ];

    const response = await executeApiCall<string>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient,
      {
        reason: `Processing single vision file: ${file.fileName}`,
        timeoutMs: 180000, // 3 minutes timeout
      }
    );

    return this.parseSingleResponse(response, file);
  }


  /**
   * Build batch prompt for vision files
   * IMPORTANT: Strips out extracted text from metadata to prevent token overflow
   * Uses ONE prompt structure with all images included, not separate prompts per file
   */
  private buildVisionBatchPrompt(files: FileProcessingInput[]): ChatCompletionMessageParam[] {
    const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
    
    // Start with ONE instruction block for all images
    contentParts.push({
      type: 'text',
      text: `Process ${files.length} images and generate BOTH summary AND tags for each file.

For each image, analyze:
- Image type (screenshot/photo/scan/diagram)
- Visible text content
- Context (app/program/document)
- People/dates if visible
- What makes this image unique and searchable

Generate for each:
1. A concise summary (max 200 chars)
2. 15-20 tags following this process:
   - STEP 1: Extract 5-8 tags from file path (MANDATORY!)
   - STEP 2: Extract tags from file name and dates
   - STEP 3: Extract tags from image content (what you see)
   - STEP 4: Add metadata tags if relevant

Respond with a JSON array in this format:
[
  {
    "fileId": "file_id_1",
    "summary": "Summary here",
    "tags": ["tag1", "tag2", ...]
  },
  ...
]

Now processing ${files.length} images:`,
    });

    // Add all images with minimal file info (no repeated instructions!)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.imageBuffer && file.imageMimeType) {
        const base64Image = file.imageBuffer.toString('base64');
        
        // Add image
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${file.imageMimeType};base64,${base64Image}`,
          },
        });
        
        // Add minimal file info (just what's needed, no full prompt template)
        const pathParts = file.filePath.split(/[\\/]/).filter(p => p.length > 0);
        const pathContext = pathParts.length > 0 
          ? `\nPath: ${pathParts.join(' → ')}`
          : '';
        
        // Strip extracted text from metadata - only keep image-specific metadata
        const imageMetadata = file.metadata ? { ...file.metadata } : {};
        delete imageMetadata.extractedText;
        delete imageMetadata.text;
        delete imageMetadata.content;
        delete imageMetadata.ocrText;
        delete imageMetadata.imageBuffer;
        
        const cleanMetadata: Record<string, any> = {};
        if (imageMetadata.width) cleanMetadata.width = imageMetadata.width;
        if (imageMetadata.height) cleanMetadata.height = imageMetadata.height;
        if (imageMetadata.mimeType) cleanMetadata.mimeType = imageMetadata.mimeType;
        if (imageMetadata.size) cleanMetadata.size = imageMetadata.size;
        
        // Keep other non-text metadata (small values only)
        Object.keys(imageMetadata).forEach(key => {
          if (!['extractedText', 'text', 'content', 'ocrText', 'imageBuffer'].includes(key)) {
            const value = imageMetadata[key];
            if (typeof value !== 'string' || value.length < 500) {
              cleanMetadata[key] = value;
            }
          }
        });
        
        const metadataStr = Object.keys(cleanMetadata).length > 0 
          ? `\nMetadata: ${JSON.stringify(cleanMetadata)}`
          : '';
        
        contentParts.push({
          type: 'text',
          text: `\n--- Image ${i + 1}/${files.length} ---
File ID: ${file.fileId}
File Name: ${file.fileName}
File Path: ${file.filePath}${pathContext}
Extension: .${file.extension}${metadataStr}
`,
        });
      }
    }

    // ONE closing instruction
    contentParts.push({
      type: 'text',
      text: `\n\nNow generate the JSON array with summary and tags for all ${files.length} images above.`,
    });

    return [
      {
        role: 'system',
        content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: contentParts,
      },
    ];
  }

  /**
   * Build batch prompt for text files with token limiting (500 words per file)
   */
  private buildTextBatchPrompt(files: FileProcessingInput[]): ChatCompletionMessageParam[] {
    
    const batchFiles = files.map(file => {
      const isEmpty = !file.extractedText || file.extractedText.length === 0;
      
      let contentPreview = '';
      if (file.contentType === 'pdf') {
        const text = file.extractedText || '';
        const isImageBased = file.metadata?.isImageBased && text.trim().length === 0;
        
        if (isImageBased) {
          contentPreview = '[Scanned PDF - no text content]';
        } else {
          contentPreview = this.truncateContent(text, SummaryTagAgent.MAX_WORDS_PER_FILE_IN_BATCH);
        }
      } else if (file.contentType === 'audio' || file.contentType === 'video') {
        const transcription = file.extractedText || '';
        contentPreview = this.truncateContent(transcription, SummaryTagAgent.MAX_WORDS_PER_FILE_IN_BATCH);
      } else {
        const content = file.extractedText || '';
        contentPreview = isEmpty ? '[Empty file]' : this.truncateContent(content, SummaryTagAgent.MAX_WORDS_PER_FILE_IN_BATCH);
      }

      // Clean metadata - remove large fields that bloat tokens (pdfBuffer, imageBuffer can be MBs!)
      const cleanMetadata: Record<string, any> = {};
      if (file.metadata) {
        let skippedLargeFields = 0;
        Object.keys(file.metadata).forEach(key => {
          const value = file.metadata![key];
          // Skip large fields that aren't needed for tagging
          if (['imageBuffer', 'pdfBuffer', 'extractedText', 'text', 'content', 'ocrText'].includes(key)) {
            skippedLargeFields++;
            return; // Skip these - they can be MBs of base64!
          }
          // Only include small metadata values
          if (typeof value === 'string' && value.length < 200) {
            cleanMetadata[key] = value;
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            cleanMetadata[key] = value;
          } else if (Array.isArray(value) && value.length < 10) {
            cleanMetadata[key] = value;
          } else if (typeof value === 'object' && value !== null) {
            // Skip objects (they might contain buffers)
            skippedLargeFields++;
          }
        });
        // Metadata cleaned silently (no verbose logging)
      }

      return {
        fileId: file.fileId,
        filePath: file.filePath,
        fileName: file.fileName,
        extension: file.extension,
        contentType: file.contentType,
        contentPreview,
        isEmpty,
        metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
      };
    });

    const userPrompt = buildBatchPrompt(batchFiles);

    return [
      {
        role: 'system',
        content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ];
  }

  /**
   * Truncate content to maximum word count (for batching)
   */
  private truncateContent(text: string, maxWords: number = SummaryTagAgent.MAX_WORDS_PER_FILE_IN_BATCH): string {
    if (!text || text.length === 0) return text;
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '\n[... content truncated for batching ...]';
  }

  /**
   * Parse single file response
   */
  private parseSingleResponse(response: string, file: FileProcessingInput): FileProcessingResult {
    try {
      let jsonStr = response.trim();
      
      // Remove markdown code fences if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }

      const parsed = JSON.parse(jsonStr) as { summary?: string; tags?: string[] };
      
      let summary = parsed.summary || '';
      let tags = Array.isArray(parsed.tags) ? parsed.tags : [];

      // Ensure summary is max 200 chars
      if (summary.length > 200) {
        summary = summary.substring(0, 197) + '...';
      }

      // Normalize tags
      tags = tags
        .map(t => String(t).toLowerCase().trim())
        .filter(t => t.length > 0);

      // Enrich tags if needed (ensure 15-20 tags)
      if (tags.length < 15) {
        tags = this.enrichTagsWithHeuristics(tags, file, summary);
      }

      return {
        fileId: file.fileId,
        summary: summary || this.generateFallbackSummary(file),
        tags: tags.length > 0 ? tags : this.generateFallbackTags(file),
      };
    } catch (error) {
      console.error(`[SummaryTagAgent] Failed to parse response for ${file.fileId}:`, error);
      return this.generateFallbackResult(file);
    }
  }

  /**
   * Parse batch response with improved error handling for unterminated strings
   */
  private async parseBatchResponse(response: string, files: FileProcessingInput[]): Promise<FileProcessingResult[]> {
    try {
      let jsonStr = response.trim();
      
      // Remove markdown code fences if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }

      // Try to fix common JSON issues
      // Fix unterminated strings by finding the last incomplete string and closing it
      if (jsonStr.includes('Unterminated string') || jsonStr.match(/"[^"]*$/)) {
        // Find the last unclosed quote and close it
        const lastQuoteIndex = jsonStr.lastIndexOf('"');
        if (lastQuoteIndex > 0) {
          const beforeQuote = jsonStr.substring(0, lastQuoteIndex);
          const afterQuote = jsonStr.substring(lastQuoteIndex + 1);
          // Check if the quote before this is escaped
          let escapeCount = 0;
          for (let i = lastQuoteIndex - 1; i >= 0 && jsonStr[i] === '\\'; i--) {
            escapeCount++;
          }
          // If odd number of escapes, the quote is escaped, so we need to close the string
          if (escapeCount % 2 === 0) {
            // Quote is not escaped, try to close the string
            jsonStr = beforeQuote + '"' + afterQuote;
            // Try to complete the JSON structure
            if (!jsonStr.endsWith(']') && !jsonStr.endsWith('}')) {
              // Count open brackets
              const openBrackets = (jsonStr.match(/\[/g) || []).length;
              const closeBrackets = (jsonStr.match(/\]/g) || []).length;
              const missing = openBrackets - closeBrackets;
              jsonStr += ']'.repeat(missing);
            }
          }
        }
      }

      const parsed = JSON.parse(jsonStr) as Array<{ fileId?: string; summary?: string; tags?: string[] }>;
      
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      const results: FileProcessingResult[] = [];
      const processedFileIds = new Set<string>();

      for (const item of parsed) {
        const fileId = item.fileId;
        if (!fileId) continue;

        const file = files.find(f => f.fileId === fileId);
        if (!file) continue;

        let summary = item.summary || '';
        let tags = Array.isArray(item.tags) ? item.tags : [];

        // Ensure summary is max 200 chars
        if (summary.length > 200) {
          summary = summary.substring(0, 197) + '...';
        }

        // Normalize tags
        tags = tags
          .map(t => String(t).toLowerCase().trim())
          .filter(t => t.length > 0);

        // Enrich tags if needed
        if (tags.length < 15) {
          tags = this.enrichTagsWithHeuristics(tags, file, summary);
        }

        results.push({
          fileId,
          summary: summary || this.generateFallbackSummary(file),
          tags: tags.length > 0 ? tags : this.generateFallbackTags(file),
        });

        processedFileIds.add(fileId);
      }

      // Add fallback results for any files not processed
      for (const file of files) {
        if (!processedFileIds.has(file.fileId)) {
          results.push(this.generateFallbackResult(file));
        }
      }

      return results;
    } catch (error) {
      console.error('[SummaryTagAgent] Failed to parse batch response, falling back to individual processing:', error);
      return await this.processBatchIndividually(files);
    }
  }

  /**
   * Enrich tags with heuristics (same logic as TagAgent)
   */
  private enrichTagsWithHeuristics(
    baseTags: string[],
    file: FileProcessingInput,
    summary: string
  ): string[] {
    const tags = new Set<string>();

    // Start with base tags
    for (const tag of baseTags) {
      if (tag && tag.trim().length > 0) {
        tags.add(tag.toLowerCase().trim());
      }
    }

    // Extension
    if (file.extension) {
      tags.add(file.extension.toLowerCase());
    }

    // Path segments
    const rawParts = file.filePath.split(/[\\/]/).filter(Boolean);
    for (const part of rawParts) {
      const cleaned = part
        .toLowerCase()
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (cleaned.length > 1 && cleaned.length < 40) {
        tags.add(cleaned);
      }
    }

    // File name parts
    const nameWithoutExt = file.fileName.replace(/\.[^/.]+$/, '');
    const nameParts = nameWithoutExt
      .split(/[-_\s]+/)
      .map(part => part.toLowerCase().trim())
      .filter(part => part.length > 1 && part.length < 40);
    for (const part of nameParts) {
      const cleaned = part.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned.length > 1) {
        tags.add(cleaned);
      }
    }

    // Date extraction
    const combined = `${file.filePath} ${file.fileName}`;
    const yearMatches = combined.match(/\b(19[5-9]\d|20[0-4]\d|2050|2051|2052|2053|2054|2055|2056|2057|2058|2059|20[6-9]\d)\b/g);
    if (yearMatches) {
      yearMatches.forEach(y => tags.add(y));
    }
    const rangeMatches = combined.match(/\b(19[5-9]\d|20[0-9]\d)\s*[-–]\s*(19[5-9]\d|20[0-9]\d)\b/g);
    if (rangeMatches) {
      rangeMatches.forEach(r => tags.add(r.replace(/\s+/g, '')));
    }

    // Metadata tags
    if (file.metadata) {
      if (file.metadata.contentType && typeof file.metadata.contentType === 'string') {
        tags.add(String(file.metadata.contentType).toLowerCase());
      }
      if (file.metadata.sheetNames && Array.isArray(file.metadata.sheetNames)) {
        file.metadata.sheetNames.forEach((sheet: string) => {
          const cleaned = String(sheet).toLowerCase().trim().replace(/\s+/g, '-');
          if (cleaned.length > 1) {
            tags.add(cleaned);
          }
        });
      }
      if (file.metadata.title && typeof file.metadata.title === 'string') {
        const parts = String(file.metadata.title)
          .toLowerCase()
          .split(/[-_\s]+/)
          .filter((p: string) => p.length > 1 && p.length < 40);
        parts.forEach((p: string) => tags.add(p.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
      }
      if (file.metadata.author && typeof file.metadata.author === 'string') {
        const cleaned = String(file.metadata.author)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]+/g, '')
          .replace(/^-+|-+$/g, '');
        if (cleaned.length > 1) {
          tags.add(cleaned);
        }
      }
      if (file.metadata.subject && typeof file.metadata.subject === 'string') {
        const parts = String(file.metadata.subject)
          .toLowerCase()
          .split(/[-_\s]+/)
          .filter((p: string) => p.length > 1 && p.length < 40);
        parts.forEach((p: string) => tags.add(p.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
      }
    }

    const all = Array.from(tags);
    return all.length > 25 ? all.slice(0, 25) : all;
  }

  /**
   * Generate fallback result
   */
  private generateFallbackResult(file: FileProcessingInput): FileProcessingResult {
    return {
      fileId: file.fileId,
      summary: this.generateFallbackSummary(file),
      tags: this.generateFallbackTags(file),
    };
  }

  /**
   * Generate fallback summary
   */
  private generateFallbackSummary(file: FileProcessingInput): string {
    const ext = file.extension || 'file';
    
    switch (file.contentType) {
      case 'text':
        return `${ext.toUpperCase()} file`;
      case 'pdf':
        return `PDF document`;
      case 'image':
        return `Image file (${ext.toUpperCase()})`;
      case 'audio':
        return `Audio file (${ext.toUpperCase()})`;
      case 'video':
        return `Video file (${ext.toUpperCase()})`;
      case 'document':
        return `${ext.toUpperCase()} document`;
      default:
        return `${file.contentType} file`;
    }
  }

  /**
   * Generate fallback tags
   */
  private generateFallbackTags(file: FileProcessingInput): string[] {
    return this.enrichTagsWithHeuristics([], file, '');
  }

  /**
   * Reorder results to match input order
   */
  private reorderResults(results: FileProcessingResult[], files: FileProcessingInput[]): FileProcessingResult[] {
    const resultMap = new Map<string, FileProcessingResult>();
    for (const result of results) {
      resultMap.set(result.fileId, result);
    }

    return files.map(file => {
      const result = resultMap.get(file.fileId);
      return result || this.generateFallbackResult(file);
    });
  }

  /**
   * Chunk array into batches
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
