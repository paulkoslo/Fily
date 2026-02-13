/**
 * SummaryTagAgent - Fallback Generation
 * 
 * Generates fallback results when LLM API calls fail or return invalid data.
 * Ensures the extraction pipeline never stops - taxonomy can always proceed.
 * 
 * Workflow Context:
 * - Used when: API errors, timeouts, invalid responses, or missing LLM client
 * - generateFallbackResult: Creates complete result with summary + tags
 * - generateFallbackSummary: Simple summary based on file type/extension
 * - generateFallbackTags: Uses tag-enricher to extract tags from path/metadata
 * 
 * These fallbacks ensure robustness - even if AI fails, files get basic tags for taxonomy.
 */
import type { FileProcessingInput, FileProcessingResult } from './types';
import { enrichTagsWithHeuristics } from './tag-enricher';

/**
 * Generate fallback result
 */
export function generateFallbackResult(file: FileProcessingInput): FileProcessingResult {
  return {
    fileId: file.fileId,
    summary: generateFallbackSummary(file),
    tags: generateFallbackTags(file),
  };
}

/**
 * Generate fallback summary
 */
export function generateFallbackSummary(file: FileProcessingInput): string {
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
export function generateFallbackTags(file: FileProcessingInput): string[] {
  return enrichTagsWithHeuristics([], file, '');
}
