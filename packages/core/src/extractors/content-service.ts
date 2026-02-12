import type { DatabaseManager } from '../db';
import { ExtractorManager } from './extractor-manager';
import { ExtractionOrchestrator } from '../agents/extraction-orchestrator';
import type { FileProcessingResult } from '../agents/summary-tag-agent';
import { WorkerPool } from '../agents/worker-pool';
import type { FileRecord, ExtractionProgress } from '../ipc/contracts';
import { truncateMetadata } from './extractor-utils';
import * as fs from 'fs';

export class ContentService {
  private extractorManager: ExtractorManager;
  private orchestrator: ExtractionOrchestrator;
  private db: DatabaseManager;
  private workerPool: WorkerPool;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.workerPool = new WorkerPool(50); // Max 50 concurrent AI workers
    this.extractorManager = new ExtractorManager(this.workerPool); // Pass worker pool for AudioExtractor
    
    // Create orchestrator - progress callback will be set per-extraction
    this.orchestrator = new ExtractionOrchestrator(this.workerPool);
  }

  async extractContent(
    files: FileRecord[],
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<{ filesProcessed: number; errors: number }> {
    let filesProcessed = 0;
    let errors = 0;

    if (files.length === 0) {
      return { filesProcessed: 0, errors: 0 };
    }


    // Step 1: Extract and process files ONE AT A TIME to minimize memory usage
    // This prevents loading all files into memory simultaneously
    const filesToProcess: Array<{
      fileId: string;
      filePath: string;
      fileName: string;
      extension: string;
      extractedContent: any;
      metadata?: Record<string, any>;
      // Store file path for lazy image loading
      imagePath?: string;
    }> = [];
    const fileResultMap = new Map<string, { file: FileRecord; result: any; error: any }>();

    // Process files sequentially to minimize memory footprint
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Extract content (one at a time)
      let result: any;
      let extractError: any = null;
      try {
        result = await this.extractorManager.extract(file.path, file.extension);
      } catch (error) {
        extractError = error;
      }

      // Handle errors immediately and store to DB
      if (extractError || !result?.success || !result?.content) {
        await this.db.upsertFileContent(
          file.file_id,
          'none',
          null,
          null,
          [],
          null,
          result?.extractorVersion || 'unknown',
          extractError instanceof Error ? extractError.message : result?.error || 'Unknown error'
        );
        errors++;
        
      // Update progress
      onProgress?.({
        status: 'extracting',
        filesProcessed: i + 1,
        filesTotal: files.length,
        currentFile: file.name,
        message: `Extracting raw content: ${i + 1}/${files.length} files`,
        step: `Step 1/4: Extracting raw content...`,
        phase: 'extracting',
        totalSteps: 0,
        currentStep: 1,
        batchesTotal: 0,
        batchesSent: 0,
        batchesCompleted: 0,
      });
        continue;
      }

      // Prepare metadata (without loading image buffers yet)
      // CRITICAL: Limit metadata size to prevent memory issues
      const metadata: any = {
        extension: file.extension,
        fileName: file.name,
        filePath: file.path,
        ...result.content.metadata,
      };

      // Add PDF-specific metadata
      if (result.content.contentType === 'pdf' && result.content.metadata) {
        metadata.pdfTitle = result.content.metadata.title;
        metadata.pdfAuthor = result.content.metadata.author;
        metadata.pdfSubject = result.content.metadata.subject;
        metadata.pdfPages = result.content.metadata.pages;
      }

      // Add document-specific metadata
      if (result.content.contentType === 'document' && result.content.metadata) {
        metadata.title = result.content.metadata.title;
        metadata.author = result.content.metadata.author;
        metadata.subject = result.content.metadata.subject;
      }

      // For images: store path for lazy loading (don't load buffer yet!)
      const imagePath = result.content.contentType === 'image' ? file.path : undefined;
      if (imagePath) {
        metadata.imageMimeType = result.content.metadata?.mimeType || 'image/jpeg';
      }

      // CRITICAL: Truncate metadata to max 2000 characters to prevent memory bloat
      const truncatedMetadata = truncateMetadata(metadata);

      // Add to processing queue (without image buffer - will be loaded lazily)
      filesToProcess.push({
        fileId: file.file_id,
        filePath: file.path,
        fileName: file.name,
        extension: file.extension,
        extractedContent: result.content,
        metadata: truncatedMetadata || metadata, // Use truncated metadata
        imagePath, // Store path for lazy loading
      });

      fileResultMap.set(file.file_id, { file, result, error: null });

      // Update progress
      onProgress?.({
        status: 'extracting',
        filesProcessed: i + 1,
        filesTotal: files.length,
        currentFile: file.name,
        message: `Extracting raw content: ${i + 1}/${files.length} files`,
        step: `Step 1/4: Extracting raw content...`,
        phase: 'extracting',
        totalSteps: 0,
        currentStep: 1,
        batchesTotal: 0,
        batchesSent: 0,
        batchesCompleted: 0,
      });
    }

    // Track batches - will be updated from SummaryTagAgent callbacks
    let totalBatches = 0; // Will be set when batches are submitted
    let batchesSent = 0;
    let batchesCompleted = 0;

    // Helper to send progress update
    const sendProgressUpdate = () => {
      // Use actual totalBatches from SummaryTagAgent, or estimate if not set yet
      const displayTotal = totalBatches > 0 ? totalBatches : Math.ceil(filesToProcess.length / 5); // Rough estimate
      const currentStep = batchesSent + batchesCompleted;
      const totalSteps = totalBatches > 0 ? totalBatches * 2 : displayTotal * 2;
      
      onProgress?.({
        status: 'extracting' as const,
        filesProcessed,
        filesTotal: files.length,
        currentFile: '',
        message: `Processing batches: ${batchesSent}/${displayTotal} sent, ${batchesCompleted}/${displayTotal} completed`,
        step: `Step 2/4: AI processing (summaries & tags)...`,
        phase: 'extracting',
        totalSteps: totalSteps,
        currentStep: currentStep,
        batchesTotal: displayTotal,
        batchesSent: batchesSent,
        batchesCompleted: batchesCompleted,
      });
    };
    
    // Initial progress: 0/0 batches
    sendProgressUpdate();
    
    // Create orchestrator with callbacks
    const orchestratorWithProgress = new ExtractionOrchestrator(
      this.workerPool,
      (message: string) => {
        // Track when batches are being sent
        // SummaryTagAgent calls onProgress with "Submitted X batches to worker pool..."
        if (message.includes('Submitted') && message.includes('batches')) {
          // Extract number from message like "Submitted 84 batches to worker pool..."
          const match = message.match(/Submitted (\d+) batches/);
          if (match) {
            batchesSent = parseInt(match[1], 10);
            totalBatches = batchesSent; // Use actual count from SummaryTagAgent
            sendProgressUpdate();
          }
        }
      },
      // Stream batches to DB as they complete
      async (batchNum: number, totalBatchesFromAgent: number, batchResults: FileProcessingResult[]) => {
        // Update totalBatches from SummaryTagAgent (most accurate)
        if (totalBatchesFromAgent > totalBatches) {
          totalBatches = totalBatchesFromAgent;
        }
        
        // Batch completed
        batchesCompleted++;
        
        // Update progress
        sendProgressUpdate();
        
        // Immediately store this batch to DB (streaming writes!)
        // CRITICAL: Process and release memory immediately after each batch
        for (const result of batchResults) {
          const fileData = fileResultMap.get(result.fileId);
          if (!fileData) {
            continue;
          }
          
          const { file, result: extractResult } = fileData;

          try {
            await this.db.upsertFileContent(
              file.file_id,
              extractResult.content.contentType,
              extractResult.content.extractedText,
              result.summary,
              extractResult.content.keywords,
              extractResult.content.metadata || null,
              extractResult.extractorVersion,
              null,
              result.tags
            );
            filesProcessed++;
          } catch (dbError) {
            console.error(`[ContentService] ❌ Failed to store ${file.name} to DB:`, dbError);
            errors++;
          }
          
          // CRITICAL: Remove from map to free memory immediately after processing
          fileResultMap.delete(result.fileId);
        }
      }
    );

    // STEP 2: Submit ALL files to processBatch() ONCE
    // processBatch() will create batches internally and submit them all concurrently
    // Images are loaded lazily when each batch actually runs (in ExtractionOrchestrator)
    console.log(`[ContentService] 📋 Processing ${filesToProcess.length} files - batches will be created by SummaryTagAgent`);
    
    // processBatch() handles batching internally and submits all batches concurrently
    // It will call onBatchComplete for each batch as it completes
    await orchestratorWithProgress.processBatch(filesToProcess);
    
    console.log(`[ContentService] ✅ All batches completed`);

    // Final check - wait for any remaining worker pool tasks
    const stats = this.workerPool.getStats();
    if (stats.active > 0 || stats.queued > 0) {
      await this.workerPool.waitForCompletion();
    }

    // All steps complete
    const finalTotalSteps = totalBatches > 0 ? totalBatches * 2 : batchesSent * 2;
    onProgress?.({
      status: 'done',
      filesProcessed,
      filesTotal: files.length,
      currentFile: '',
      message: `Extracted content from ${filesProcessed} files (${errors} errors)`,
      step: `Step 2/4: AI processing (summaries & tags)...`,
      phase: 'done',
      totalSteps: finalTotalSteps,
      currentStep: finalTotalSteps,
      batchesTotal: totalBatches,
      batchesSent: batchesSent,
      batchesCompleted: batchesCompleted,
    });

    return { filesProcessed, errors };
  }
}
