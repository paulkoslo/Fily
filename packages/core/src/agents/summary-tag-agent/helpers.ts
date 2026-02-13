/**
 * SummaryTagAgent - Helper Functions
 * 
 * Utility functions used throughout the SummaryTagAgent workflow for file organization,
 * validation, and content processing.
 * 
 * Workflow Context:
 * - groupFilesByProcessingType: Separates vision vs text files before batching (Step 1 of processBatch)
 * - isValidImage: Validates images before API calls (prevents API errors)
 * - chunk: Splits files into batches for parallel processing (used by WorkerPool)
 * - truncateContent: Limits content size for token management (prevents API limits)
 * - reorderResults: Ensures output order matches input order (maintains file relationships)
 * 
 * These helpers are pure functions used by batch-processor and file-processor modules.
 */
import type { FileProcessingInput, FileProcessingResult } from './types';
import { BASE64_IMAGE_MAX_SIZE_BYTES, SUMMARY_TAG_MAX_WORDS_PER_FILE } from '../../planner/constants';

/**
 * Chunk array into batches
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Group files by processing type (vision vs text)
 * Also validates image files and filters out invalid ones
 */
export function groupFilesByProcessingType(files: FileProcessingInput[]): {
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
      if (isValidImage(file)) {
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
export function isValidImage(file: FileProcessingInput): boolean {
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
  if (base64Image.length > BASE64_IMAGE_MAX_SIZE_BYTES) {
    return false;
  }

  return true;
}

/**
 * Truncate content to maximum word count (for batching)
 */
export function truncateContent(text: string, maxWords: number = SUMMARY_TAG_MAX_WORDS_PER_FILE): string {
  if (!text || text.length === 0) return text;
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '\n[... content truncated for batching ...]';
}

/**
 * Reorder results to match input order
 */
export function reorderResults(
  results: FileProcessingResult[],
  files: FileProcessingInput[],
  generateFallback: (file: FileProcessingInput) => FileProcessingResult
): FileProcessingResult[] {
  const resultMap = new Map<string, FileProcessingResult>();
  for (const result of results) {
    resultMap.set(result.fileId, result);
  }

  return files.map(file => {
    const result = resultMap.get(file.fileId);
    return result || generateFallback(file);
  });
}
