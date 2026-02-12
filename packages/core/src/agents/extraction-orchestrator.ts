import type { ExtractedContent } from '../extractors/types';
import { SummaryTagAgent, type FileProcessingInput, type FileProcessingResult } from './summary-tag-agent';
import type { WorkerPool } from './worker-pool';

// Re-export types for convenience
export type { FileProcessingInput, FileProcessingResult };

/**
 * Extraction Orchestrator
 * 
 * This is the "grand script" that chains together:
 * 1. Extractors (extract raw content)
 * 2. SummaryTagAgent (generates both summaries AND tags in batched API calls)
 * 3. Future agents can use summary/tag data (organization, etc.)
 * 
 * The orchestrator coordinates the entire pipeline and provides a clean interface
 * for processing individual files or batches.
 * 
 * Uses SummaryTagAgent internally for efficient batched processing.
 */
export class ExtractionOrchestrator {
  private summaryTagAgent: SummaryTagAgent;

  constructor(
    workerPool?: WorkerPool, 
    onProgress?: (message: string) => void,
    onBatchComplete?: (batchNumber: number, totalBatches: number, results: FileProcessingResult[]) => Promise<void>
  ) {
    this.summaryTagAgent = new SummaryTagAgent(workerPool, onProgress, onBatchComplete);
  }

  /**
   * Process extracted content through SummaryTagAgent to generate summary
   * 
   * This is a convenience method that wraps SummaryTagAgent for backward compatibility.
   * For better efficiency, use processBatch() or processSingle() directly.
   */
  async generateSummary(
    extractedContent: ExtractedContent,
    metadata?: {
      // For PDFs
      pdfTitle?: string;
      pdfAuthor?: string;
      pdfSubject?: string;
      pdfPages?: number;
      // For documents (DOCX, XLSX, PPTX)
      title?: string;
      author?: string;
      subject?: string;
      // For images
      imageBuffer?: Buffer;
      imageMimeType?: string;
      // For audio/video and text
      extension?: string;
      fileName?: string;
      filePath?: string;
    }
  ): Promise<string> {
    try {
      const fileId = metadata?.filePath ? `temp_${Date.now()}` : `temp_${Date.now()}`;
      const filePath = metadata?.filePath || '';
      const fileName = metadata?.fileName || `file.${metadata?.extension || 'txt'}`;
      const extension = metadata?.extension || 'txt';

      // Map content type
      let contentType: 'text' | 'pdf' | 'document' | 'image' | 'audio' | 'video' = 'text';
      if (extractedContent.contentType === 'pdf') {
        contentType = 'pdf';
      } else if (extractedContent.contentType === 'document') {
        contentType = 'document';
      } else if (extractedContent.contentType === 'image') {
        contentType = 'image';
      } else if (extractedContent.contentType === 'audio') {
        contentType = 'audio';
      } else if (extractedContent.contentType === 'video') {
        contentType = 'video';
      }

      // Prepare metadata
      const combinedMetadata: Record<string, any> = {
        extension,
        fileName,
        filePath,
        ...extractedContent.metadata,
      };

      if (metadata) {
        if (metadata.pdfTitle) combinedMetadata.pdfTitle = metadata.pdfTitle;
        if (metadata.pdfAuthor) combinedMetadata.pdfAuthor = metadata.pdfAuthor;
        if (metadata.pdfSubject) combinedMetadata.pdfSubject = metadata.pdfSubject;
        if (metadata.pdfPages) combinedMetadata.pdfPages = metadata.pdfPages;
        if (metadata.title) combinedMetadata.title = metadata.title;
        if (metadata.author) combinedMetadata.author = metadata.author;
        if (metadata.subject) combinedMetadata.subject = metadata.subject;
      }

      const input: FileProcessingInput = {
        fileId,
        filePath,
        fileName,
        extension,
        contentType,
        extractedText: extractedContent.extractedText || undefined,
        metadata: combinedMetadata,
        imageBuffer: metadata?.imageBuffer,
        imageMimeType: metadata?.imageMimeType,
      };

      const result = await this.summaryTagAgent.processSingle(input);
      return result.summary;
    } catch (error) {
      // Return fallback based on content type
      return this.generateFallbackSummary(extractedContent, metadata);
    }
  }

  private generateFallbackSummary(
    extractedContent: ExtractedContent,
    metadata?: { extension?: string }
  ): string {
    const ext = metadata?.extension || 'file';
    
    switch (extractedContent.contentType) {
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
      default:
        return `${extractedContent.contentType} file`;
    }
  }

  /**
   * Generate tags for a file (backward compatibility method)
   * 
   * NOTE: This method still calls SummaryTagAgent which generates BOTH summary and tags.
   * The summary parameter is ignored - SummaryTagAgent generates its own summary.
   * 
   * For better efficiency, use processBatch() or processSingle() directly.
   */
  async generateTags(
    filePath: string,
    fileName: string,
    extractedContent: ExtractedContent,
    summary: string, // Ignored - SummaryTagAgent generates its own summary
    metadata?: {
      // For PDFs
      pdfTitle?: string;
      pdfAuthor?: string;
      pdfSubject?: string;
      pdfPages?: number;
      // For documents (DOCX, XLSX, PPTX)
      title?: string;
      author?: string;
      subject?: string;
      // For images
      imageBuffer?: Buffer;
      imageMimeType?: string;
      // For audio/video and text
      extension?: string;
      // Additional metadata from extractors
      [key: string]: any;
    }
  ): Promise<string[]> {
    try {
      const fileId = `temp_${Date.now()}`;
      const extension = metadata?.extension || fileName.split('.').pop() || 'txt';

      // Map content type
      let contentType: 'text' | 'pdf' | 'document' | 'image' | 'audio' | 'video' = 'text';
      if (extractedContent.contentType === 'pdf') {
        contentType = 'pdf';
      } else if (extractedContent.contentType === 'document') {
        contentType = 'document';
      } else if (extractedContent.contentType === 'image') {
        contentType = 'image';
      } else if (extractedContent.contentType === 'audio') {
        contentType = 'audio';
      } else if (extractedContent.contentType === 'video') {
        contentType = 'video';
      }

      // Combine all metadata
      const combinedMetadata: Record<string, any> = {
        contentType: extractedContent.contentType,
        extension,
        ...extractedContent.metadata,
      };

      if (metadata) {
        if (metadata.pdfTitle) combinedMetadata.pdfTitle = metadata.pdfTitle;
        if (metadata.pdfAuthor) combinedMetadata.pdfAuthor = metadata.pdfAuthor;
        if (metadata.pdfSubject) combinedMetadata.pdfSubject = metadata.pdfSubject;
        if (metadata.pdfPages) combinedMetadata.pages = metadata.pdfPages;
        if (metadata.title) combinedMetadata.title = metadata.title;
        if (metadata.author) combinedMetadata.author = metadata.author;
        if (metadata.subject) combinedMetadata.subject = metadata.subject;
      }

      const input: FileProcessingInput = {
        fileId,
        filePath,
        fileName,
        extension,
        contentType,
        extractedText: extractedContent.extractedText || undefined,
        metadata: combinedMetadata,
        imageBuffer: metadata?.imageBuffer,
        imageMimeType: metadata?.imageMimeType,
      };

      const result = await this.summaryTagAgent.processSingle(input);
      return result.tags;
    } catch (error) {
      // Return fallback tags
      return this.generateFallbackTags(filePath, fileName, metadata?.extension || '');
    }
  }

  /**
   * Generate both summary AND tags for a file (recommended method)
   * Uses SummaryTagAgent internally for efficient processing.
   */
  async generateSummaryAndTags(
    filePath: string,
    fileName: string,
    extractedContent: ExtractedContent,
    metadata?: {
      // For PDFs
      pdfTitle?: string;
      pdfAuthor?: string;
      pdfSubject?: string;
      pdfPages?: number;
      // For documents (DOCX, XLSX, PPTX)
      title?: string;
      author?: string;
      subject?: string;
      // For images
      imageBuffer?: Buffer;
      imageMimeType?: string;
      // For audio/video and text
      extension?: string;
      // Additional metadata from extractors
      [key: string]: any;
    }
  ): Promise<{ summary: string; tags: string[] }> {
    const fileId = `temp_${Date.now()}`;
    const extension = metadata?.extension || fileName.split('.').pop() || 'txt';

    // Map content type
    let contentType: 'text' | 'pdf' | 'document' | 'image' | 'audio' | 'video' = 'text';
    if (extractedContent.contentType === 'pdf') {
      contentType = 'pdf';
    } else if (extractedContent.contentType === 'document') {
      contentType = 'document';
    } else if (extractedContent.contentType === 'image') {
      contentType = 'image';
    } else if (extractedContent.contentType === 'audio') {
      contentType = 'audio';
    } else if (extractedContent.contentType === 'video') {
      contentType = 'video';
    }

    // Prepare metadata
    const combinedMetadata: Record<string, any> = {
      extension,
      fileName,
      filePath,
      ...extractedContent.metadata,
    };

    if (metadata) {
      if (metadata.pdfTitle) combinedMetadata.pdfTitle = metadata.pdfTitle;
      if (metadata.pdfAuthor) combinedMetadata.pdfAuthor = metadata.pdfAuthor;
      if (metadata.pdfSubject) combinedMetadata.pdfSubject = metadata.pdfSubject;
      if (metadata.pdfPages) combinedMetadata.pdfPages = metadata.pdfPages;
      if (metadata.title) combinedMetadata.title = metadata.title;
      if (metadata.author) combinedMetadata.author = metadata.author;
      if (metadata.subject) combinedMetadata.subject = metadata.subject;
    }

    const input: FileProcessingInput = {
      fileId,
      filePath,
      fileName,
      extension,
      contentType,
      extractedText: extractedContent.extractedText || undefined,
      metadata: combinedMetadata,
      imageBuffer: metadata?.imageBuffer,
      imageMimeType: metadata?.imageMimeType,
    };

    return await this.summaryTagAgent.processSingle(input);
  }

  /**
   * Process a batch of files efficiently (recommended for multiple files)
   * Uses SummaryTagAgent's intelligent batching internally.
   */
  async processBatch(
    files: Array<{
      fileId: string;
      filePath: string;
      fileName: string;
      extension: string;
      extractedContent: ExtractedContent;
      metadata?: Record<string, any>;
      imagePath?: string; // Path for lazy image loading
    }>
  ): Promise<FileProcessingResult[]> {
    // LAZY LOADING: Load image buffers only when needed (right before API call)
    const inputs: FileProcessingInput[] = await Promise.all(
      files.map(async ({ fileId, filePath, fileName, extension, extractedContent, metadata, imagePath }) => {
        // Map content type
        let contentType: 'text' | 'pdf' | 'document' | 'image' | 'audio' | 'video' = 'text';
        if (extractedContent.contentType === 'pdf') {
          contentType = 'pdf';
        } else if (extractedContent.contentType === 'document') {
          contentType = 'document';
        } else if (extractedContent.contentType === 'image') {
          contentType = 'image';
        } else if (extractedContent.contentType === 'audio') {
          contentType = 'audio';
        } else if (extractedContent.contentType === 'video') {
          contentType = 'video';
        }

        // LAZY LOAD: Only load image buffer now (right before API call)
        let imageBuffer: Buffer | undefined;
        if (contentType === 'image' && imagePath) {
          try {
            const fs = await import('fs/promises');
            imageBuffer = await fs.readFile(imagePath);
          } catch (error) {
            console.warn(`[ExtractionOrchestrator] Failed to load image ${imagePath}:`, error);
          }
        } else if (metadata?.imageBuffer) {
          // Fallback: use existing buffer if provided
          imageBuffer = metadata.imageBuffer;
        }

        return {
          fileId,
          filePath,
          fileName,
          extension,
          contentType,
          extractedText: extractedContent.extractedText || undefined,
          metadata: {
            extension,
            fileName,
            filePath,
            ...extractedContent.metadata,
            ...metadata,
            // Remove imageBuffer from metadata to avoid keeping it in memory
            imageBuffer: undefined,
          },
          imageBuffer, // Only loaded when needed
          imageMimeType: metadata?.imageMimeType,
        };
      })
    );

    const results = await this.summaryTagAgent.processBatch(inputs);
    
    // CRITICAL: Clear image buffers from results to free memory immediately
    // The buffers are no longer needed after API call
    for (const input of inputs) {
      if (input.imageBuffer) {
        // Clear reference to allow GC
        (input as any).imageBuffer = undefined;
      }
    }
    
    return results;
  }

  private generateFallbackTags(filePath: string, fileName: string, extension: string): string[] {
    const tags: string[] = [];
    
    // Extension
    if (extension) {
      tags.push(extension.toLowerCase());
    }

    // Path segments
    const pathParts = filePath.split(/[\\/]/).filter(p => p.length > 0);
    for (const part of pathParts.slice(-6)) { // Last 6 path segments
      const cleaned = part
        .toLowerCase()
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (cleaned.length > 1 && cleaned.length < 40) {
        tags.push(cleaned);
      }
    }

    // File name parts
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    const nameParts = nameWithoutExt
      .split(/[-_\s]+/)
      .map(part => part.toLowerCase().trim())
      .filter(part => part.length > 1 && part.length < 40);
    for (const part of nameParts) {
      const cleaned = part.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned.length > 1) {
        tags.push(cleaned);
      }
    }

    return tags.slice(0, 15); // Return up to 15 tags
  }
}
