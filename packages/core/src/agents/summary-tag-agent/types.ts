/**
 * SummaryTagAgent - Type Definitions
 * 
 * This file defines the core data structures used throughout the SummaryTagAgent workflow.
 * 
 * Workflow Context:
 * - FileProcessingInput: Raw file data passed to the agent (from extractors)
 * - FileProcessingResult: Processed output with summary + tags (stored in DB, used by taxonomy)
 * 
 * These types flow through: Extractors → SummaryTagAgent → Database → TaxonomyAgent
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
