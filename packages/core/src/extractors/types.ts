/**
 * Types for content extraction system
 */
export type ContentType = 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'document' | 'code' | 'none';

export interface ExtractedContent {
  contentType: ContentType;
  extractedText: string | null; // Full text content (for text/PDF/code)
  summary: string | null; // Short summary (for images/audio/video)
  keywords: string[]; // Array of keywords/tags
  metadata?: Record<string, any>; // Additional metadata (page count, duration, etc.)
}

export interface ExtractionResult {
  success: boolean;
  content: ExtractedContent | null;
  error?: string;
  extractorVersion: string;
}

export interface Extractor {
  readonly id: string;
  readonly version: string;
  readonly supportedExtensions: string[];
  
  canExtract(extension: string): boolean;
  extract(filePath: string, extension: string): Promise<ExtractionResult>;
}
