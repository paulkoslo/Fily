import type { DatabaseManager } from '../db';
import { ExtractorManager } from './extractor-manager';
import { ExtractionOrchestrator } from '../agents/extraction-orchestrator';
import { WorkerPool } from '../agents/worker-pool';
import type { FileRecord, ExtractionProgress } from '../ipc/contracts';
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
    this.orchestrator = new ExtractionOrchestrator(this.workerPool);
  }

  async extractContent(
    files: FileRecord[],
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<{ filesProcessed: number; errors: number }> {
    let filesProcessed = 0;
    let errors = 0;

    // Process all files in parallel batches
    // Extractors (non-AI) can run in parallel without limit
    // AI operations (Summary Agent, Audio transcription) go through worker pool (max 50)
    const processFile = async (file: FileRecord): Promise<void> => {
      try {
        // Step 1: Extract raw content using extractor (non-AI, can run in parallel)
        onProgress?.({
          status: 'extracting',
          filesProcessed,
          filesTotal: files.length,
          currentFile: file.name,
          message: `[Extracting] Reading content from ${file.name}...`,
        });

        const result = await this.extractorManager.extract(file.path, file.extension);

        if (result.success && result.content) {
          // Step 2: Classify content using appropriate agent via orchestrator (uses worker pool)
          let summary: string | null = null;
          let tags: string[] | null = null;
          
          try {
            // Prepare metadata for orchestrator
            const metadata: any = {
              extension: file.extension,
              fileName: file.name,
              filePath: file.path,
            };
            
            // Add PDF-specific metadata
            if (result.content.contentType === 'pdf' && result.content.metadata) {
              metadata.pdfTitle = result.content.metadata.title;
              metadata.pdfAuthor = result.content.metadata.author;
              metadata.pdfSubject = result.content.metadata.subject;
              metadata.pdfPages = result.content.metadata.pages;

              // If this is an image-based/scanned PDF (no text), pass through the original
              // PDF bytes so the Summary Agent can attempt a vision/OCR-style fallback.
              if (result.content.metadata.isImageBased && result.content.metadata.pdfBuffer) {
                try {
                  metadata.imageBuffer = Buffer.from(result.content.metadata.pdfBuffer, 'base64');
                  // Use application/pdf so downstream knows this is a PDF payload
                  metadata.imageMimeType = result.content.metadata.mimeType || 'application/pdf';
                } catch {
                  // If base64 decoding fails, ignore and continue without image buffer
                }
              }
            }
            
            // Add document-specific metadata (DOCX, XLSX, PPTX)
            if (result.content.contentType === 'document' && result.content.metadata) {
              metadata.title = result.content.metadata.title;
              metadata.author = result.content.metadata.author;
              metadata.subject = result.content.metadata.subject;
            }
            
            // For images, we need to pass the image buffer if available
            if (result.content.contentType === 'image') {
              // Image buffer is already stored in metadata by ImageExtractor
              // Convert base64 back to Buffer for Summary Agent
              if (result.content.metadata?.imageBuffer) {
                metadata.imageBuffer = Buffer.from(result.content.metadata.imageBuffer, 'base64');
                metadata.imageMimeType = result.content.metadata.mimeType || 'image/jpeg';
              } else {
                // Fallback: read file if not in metadata
                try {
                  const imageBuffer = await fs.promises.readFile(file.path);
                  metadata.imageBuffer = imageBuffer;
                  metadata.imageMimeType = result.content.metadata?.mimeType || 'image/jpeg';
                } catch (err) {
                  // Ignore error, continue without image buffer
                }
              }
            }
            
            // Step 2a: Generate classification summary using orchestrator (counts as 1 worker)
            onProgress?.({
              status: 'extracting',
              filesProcessed,
              filesTotal: files.length,
              currentFile: file.name,
              message: `[Summary Agent] Generating summary for ${file.name}...`,
            });
            
            summary = await this.orchestrator.generateSummary(result.content, metadata);
            
            // Step 2b: Generate tags using Tag Agent (uses summary, location, metadata) (counts as 1 worker)
            if (summary) {
              try {
                onProgress?.({
                  status: 'extracting',
                  filesProcessed,
                  filesTotal: files.length,
                  currentFile: file.name,
                  message: `[Tag Agent] Generating tags for ${file.name}...`,
                });
                
                tags = await this.orchestrator.generateTags(
                  file.path,
                  file.name,
                  result.content,
                  summary,
                  metadata
                );
              } catch (error) {
                // Continue without tags - we still store the summary
              }
            }
          } catch (error) {
            // Continue without summary/tags - we still store the extracted content
          }
          
          // Step 3: Store extracted content with classification summary and tags
          onProgress?.({
            status: 'extracting',
            filesProcessed,
            filesTotal: files.length,
            currentFile: file.name,
            message: `[Storing] Saving ${file.name} to database...`,
          });
          
          await this.db.upsertFileContent(
            file.file_id,
            result.content.contentType,
            result.content.extractedText,
            summary,
            result.content.keywords,
            result.content.metadata || null,
            result.extractorVersion,
            null,
            tags
          );
          filesProcessed++;
        } else {
          // Store error for debugging
          await this.db.upsertFileContent(
            file.file_id,
            'none',
            null,
            null,
            [],
            null,
            result.extractorVersion,
            result.error || 'Unknown error'
          );
          errors++;
        }
      } catch (error) {
        console.error(`[ContentService] Error extracting ${file.path}:`, error);
        errors++;
        
        await this.db.upsertFileContent(
          file.file_id,
          'none',
          null,
          null,
          [],
          null,
          'unknown',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    };

    // Process all files in parallel - extractors run immediately, AI calls queue in worker pool
    // Start all file processing tasks concurrently
    const filePromises = files.map(file => processFile(file));
    
    // Wait for all file processing to complete (this includes queued AI operations)
    await Promise.all(filePromises);
    
    // Final check - wait for any remaining worker pool tasks
    const stats = this.workerPool.getStats();
    if (stats.active > 0 || stats.queued > 0) {
      onProgress?.({
        status: 'extracting',
        filesProcessed,
        filesTotal: files.length,
        currentFile: '',
        message: `[Waiting] Processing final AI operations (${stats.active} active, ${stats.queued} queued)...`,
      });
      await this.workerPool.waitForCompletion();
    }

    onProgress?.({
      status: 'done',
      filesProcessed,
      filesTotal: files.length,
      currentFile: '',
      message: `Extracted content from ${filesProcessed} files (${errors} errors)`,
    });

    return { filesProcessed, errors };
  }
}
