import type { ExtractedContent } from '../extractors/types';
import { SummaryAgent } from './summary-agent';
import { TagAgent } from './tag-agent';
import type { WorkerPool } from './worker-pool';

/**
 * Extraction Orchestrator
 * 
 * This is the "grand script" that chains together:
 * 1. Extractors (extract raw content)
 * 2. Summary Agent (generates summaries for all file types)
 * 3. Tag Agent (generates tags based on summary, location, metadata)
 * 4. Future agents can use summary/tag data (organization, etc.)
 * 
 * The orchestrator coordinates the entire pipeline.
 */
export class ExtractionOrchestrator {
  private summaryAgent: SummaryAgent;
  private tagAgent: TagAgent;

  constructor(workerPool?: WorkerPool) {
    this.summaryAgent = new SummaryAgent(workerPool);
    this.tagAgent = new TagAgent(workerPool);
  }

  /**
   * Process extracted content through the Summary Agent
   * to generate a summary/classification
   * 
   * This summary will be used by other agents (organization, tagging, etc.)
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
    }
  ): Promise<string> {
    try {
      switch (extractedContent.contentType) {
        case 'text':
          return await this.summaryAgent.summarizeText(
            metadata?.extension || 'txt',
            extractedContent.extractedText || ''
          );

        case 'pdf': {
          const text = extractedContent.extractedText || '';
          const isImageBased = extractedContent.metadata?.isImageBased && text.trim().length === 0;

          if (isImageBased) {
            // Scanned/image-only PDF: we have no readable text, but we do have
            // metadata + (optionally) file name/path via metadata. Use a special
            // summarizer that guesses document type from this context.
            return await this.summaryAgent.summarizeScannedPDF({
              title: metadata?.pdfTitle ?? extractedContent.metadata?.title ?? null,
              author: metadata?.pdfAuthor ?? extractedContent.metadata?.author ?? null,
              subject: metadata?.pdfSubject ?? extractedContent.metadata?.subject ?? null,
              pages: metadata?.pdfPages ?? extractedContent.metadata?.pages ?? null,
              creator: extractedContent.metadata?.creator ?? null,
              producer: extractedContent.metadata?.producer ?? null,
              creationDate: extractedContent.metadata?.creationDate ?? null,
              modDate: extractedContent.metadata?.modDate ?? null,
              // Optional extras if the caller provided them
              fileName: (metadata as any)?.fileName ?? null,
              filePath: (metadata as any)?.filePath ?? null,
            });
          }

          // Normal text-based PDF summarization
          return await this.summaryAgent.summarizePDF(
            text,
            {
              title: metadata?.pdfTitle,
              author: metadata?.pdfAuthor,
              subject: metadata?.pdfSubject,
            }
          );
        }

        case 'document':
          // Handle DOCX, XLSX, PPTX files - treat similar to PDFs
          const docExtension = metadata?.extension || 'docx';
          if (['docx', 'xlsx', 'xls', 'pptx'].includes(docExtension.toLowerCase())) {
            return await this.summaryAgent.summarizePDF(
              extractedContent.extractedText || '',
              {
                title: metadata?.title,
                author: metadata?.author,
                subject: metadata?.subject,
              }
            );
          }
          // Fallback for other document types
          return await this.summaryAgent.summarizeText(
            docExtension,
            extractedContent.extractedText || ''
          );

        case 'image':
          // For images, pass the buffer directly to Summary Agent (GPT-5-nano handles images natively)
          if (metadata?.imageBuffer && metadata?.imageMimeType) {
            const imageBuffer = Buffer.from(metadata.imageBuffer);
            return await this.summaryAgent.summarizeImage(
              imageBuffer,
              metadata.imageMimeType,
              metadata?.extension || 'jpg'
            );
          }
          // Fallback if no buffer available
          return `Image file (${metadata?.extension?.toUpperCase() || 'IMAGE'})`;

        case 'audio':
        case 'video':
          return await this.summaryAgent.summarizeAudio(
            extractedContent.extractedText || '',
            metadata?.extension || 'mp3'
          );

        default:
          return `File (${extractedContent.contentType})`;
      }
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
   * Generate both summary and tags for a file
   * 
   * @param filePath - Full path to the file
   * @param fileName - Name of the file
   * @param extractedContent - Extracted content from extractors
   * @param summary - Summary generated by Summary Agent
   * @param metadata - Additional metadata
   */
  async generateTags(
    filePath: string,
    fileName: string,
    extractedContent: ExtractedContent,
    summary: string,
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
    // Combine all metadata for Tag Agent
    const tagMetadata: Record<string, any> = {
      contentType: extractedContent.contentType,
      extension: metadata?.extension,
      ...extractedContent.metadata,
    };

    if (metadata) {
      if (metadata.pdfTitle) tagMetadata.title = metadata.pdfTitle;
      if (metadata.pdfAuthor) tagMetadata.author = metadata.pdfAuthor;
      if (metadata.pdfSubject) tagMetadata.subject = metadata.pdfSubject;
      if (metadata.pdfPages) tagMetadata.pages = metadata.pdfPages;
      if (metadata.title) tagMetadata.title = metadata.title;
      if (metadata.author) tagMetadata.author = metadata.author;
      if (metadata.subject) tagMetadata.subject = metadata.subject;
    }

    return await this.tagAgent.generateTags(
      filePath,
      fileName,
      metadata?.extension || '',
      summary,
      tagMetadata
    );
  }
}
