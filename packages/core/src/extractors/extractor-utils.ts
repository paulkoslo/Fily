/**
 * Utility functions for extractors
 */

/**
 * Maximum words allowed per file extraction (1000 words)
 */
export const MAX_WORDS_PER_FILE = 1000;

/**
 * Maximum characters allowed for metadata JSON (2000 characters)
 */
export const MAX_METADATA_CHARS = 2000;

/**
 * Truncate text content to maximum word count
 */
export function truncateToWordLimit(text: string, maxWords: number = MAX_WORDS_PER_FILE): string {
  if (!text || text.length === 0) return text;
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '\n[... content truncated to 1000 words ...]';
}

/**
 * Truncate metadata object to maximum character count when serialized as JSON
 * This prevents excessive memory usage from large metadata objects
 * 
 * Strategy: Keep essential fields, truncate long string values, remove nested objects if needed
 */
export function truncateMetadata(metadata: Record<string, any> | null, maxChars: number = MAX_METADATA_CHARS): Record<string, any> | null {
  if (!metadata) return null;
  
  try {
    // First, try to stringify to check size
    const jsonString = JSON.stringify(metadata);
    if (jsonString.length <= maxChars) {
      return metadata; // No truncation needed
    }
    
    // Need to truncate - keep essential fields and truncate string values
    const truncated: Record<string, any> = {};
    
    // Essential fields to always keep (in priority order)
    const essentialFields = ['extension', 'fileName', 'filePath', 'mimeType', 'imageMimeType', 
                             'pdfTitle', 'pdfAuthor', 'pdfSubject', 'pdfPages',
                             'title', 'author', 'subject'];
    
    // First pass: add essential fields with truncation
    for (const key of essentialFields) {
      if (metadata[key] !== undefined && metadata[key] !== null) {
        if (typeof metadata[key] === 'string') {
          // Truncate long strings
          const maxFieldLength = 200; // Max length per field
          truncated[key] = metadata[key].length > maxFieldLength 
            ? metadata[key].substring(0, maxFieldLength) + '[...]'
            : metadata[key];
        } else {
          truncated[key] = metadata[key];
        }
      }
    }
    
    // Second pass: add other fields if space allows (with truncation)
    const currentJson = JSON.stringify(truncated);
    const remainingSpace = maxChars - currentJson.length - 50; // Reserve 50 chars for safety
    
    if (remainingSpace > 100) {
      for (const [key, value] of Object.entries(metadata)) {
        // Skip if already added or if it's an object/array (too complex)
        if (essentialFields.includes(key) || typeof value === 'object' || Array.isArray(value)) {
          continue;
        }
        
        if (typeof value === 'string') {
          const maxValueLength = Math.min(remainingSpace - 50, 100); // Reserve space
          truncated[key] = value.length > maxValueLength 
            ? value.substring(0, maxValueLength) + '[...]'
            : value;
        } else {
          truncated[key] = value;
        }
        
        // Check if we've exceeded limit
        const testJson = JSON.stringify(truncated);
        if (testJson.length > maxChars) {
          // Remove last added field
          delete truncated[key];
          break;
        }
      }
    }
    
    // Final check - if still too large, keep only most essential
    const finalJson = JSON.stringify(truncated);
    if (finalJson.length > maxChars) {
      const minimal: Record<string, any> = {
        extension: metadata.extension || 'unknown',
        fileName: metadata.fileName || '',
      };
      if (metadata.filePath) minimal.filePath = metadata.filePath;
      return minimal;
    }
    
    return truncated;
  } catch (error) {
    // If JSON.stringify fails, return minimal metadata
    console.warn('[extractor-utils] Failed to truncate metadata, using minimal version:', error);
    return {
      extension: metadata.extension || 'unknown',
      fileName: metadata.fileName || '',
    };
  }
}

/**
 * Execute an extraction with timeout protection
 * Notifies via console.warn if extraction takes > 10 seconds
 * Throws timeout error if extraction takes > 60 seconds
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 60000, // 60 seconds default
  warningMs: number = 10000, // 10 seconds warning
  filePath: string
): Promise<T> {
  const startTime = Date.now();
  
  // Set up warning timer
  const warningTimer = setTimeout(() => {
    const elapsed = Date.now() - startTime;
    console.warn(
      `[Extractor] ⚠️ Extraction taking longer than expected: ${filePath} (${Math.round(elapsed / 1000)}s elapsed)`
    );
  }, warningMs);

  // Set up timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Extraction timeout after ${timeoutMs}ms: ${filePath}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(warningTimer);
    return result;
  } catch (error) {
    clearTimeout(warningTimer);
    throw error;
  }
}
