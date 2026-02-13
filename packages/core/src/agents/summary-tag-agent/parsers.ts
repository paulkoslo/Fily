/**
 * SummaryTagAgent - Response Parsing
 * 
 * Parses LLM JSON responses into structured FileProcessingResult objects.
 * Handles common LLM errors: markdown fences, unterminated strings, malformed JSON.
 * 
 * Workflow Context:
 * - parseSingleResponse: Used by file-processor for individual file processing
 * - parseBatchResponse: Used by batch-processor for batch API responses
 * - Validates summary length, normalizes tags, enriches if needed
 * - Falls back to individual processing if batch parsing fails
 * 
 * This is the critical step that converts LLM output into usable data for taxonomy.
 */
import type { FileProcessingInput, FileProcessingResult } from './types';
import { enrichTagsWithHeuristics } from './tag-enricher';
import { generateFallbackResult, generateFallbackSummary, generateFallbackTags } from './fallback';
import { SUMMARY_TAG_MAX_SUMMARY_LENGTH, SUMMARY_TAG_MIN_TAGS } from '../../planner/constants';

/**
 * Parse single file response
 */
export function parseSingleResponse(
  response: string,
  file: FileProcessingInput
): FileProcessingResult {
  try {
    let jsonStr = response.trim();
    
    // Remove markdown code fences if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr) as { summary?: string; tags?: string[] };
    
    let summary = parsed.summary || '';
    let tags = Array.isArray(parsed.tags) ? parsed.tags : [];

    // Ensure summary is max SUMMARY_TAG_MAX_SUMMARY_LENGTH chars
    if (summary.length > SUMMARY_TAG_MAX_SUMMARY_LENGTH) {
      summary = summary.substring(0, 197) + '...';
    }

    // Normalize tags
    tags = tags
      .map(t => String(t).toLowerCase().trim())
      .filter(t => t.length > 0);

    // Enrich tags if needed (ensure SUMMARY_TAG_MIN_TAGS tags)
    if (tags.length < SUMMARY_TAG_MIN_TAGS) {
      tags = enrichTagsWithHeuristics(tags, file, summary);
    }

    return {
      fileId: file.fileId,
      summary: summary || generateFallbackSummary(file),
      tags: tags.length > 0 ? tags : generateFallbackTags(file),
    };
  } catch (error) {
    console.error(`[SummaryTagAgent] Failed to parse response for ${file.fileId}:`, error);
    return generateFallbackResult(file);
  }
}

/**
 * Parse batch response with improved error handling for unterminated strings
 * 
 * @param response - Raw LLM response string
 * @param files - Files that were processed in the batch
 * @param fallbackProcessor - Function to process files individually if batch parsing fails
 * @returns Parsed results or fallback results
 */
export async function parseBatchResponse(
  response: string,
  files: FileProcessingInput[],
  fallbackProcessor?: (files: FileProcessingInput[]) => Promise<FileProcessingResult[]>
): Promise<FileProcessingResult[]> {
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
      if (summary.length > SUMMARY_TAG_MAX_SUMMARY_LENGTH) {
        summary = summary.substring(0, 197) + '...';
      }

      // Normalize tags
      tags = tags
        .map(t => String(t).toLowerCase().trim())
        .filter(t => t.length > 0);

      // Enrich tags if needed
      if (tags.length < SUMMARY_TAG_MIN_TAGS) {
        tags = enrichTagsWithHeuristics(tags, file, summary);
      }

      results.push({
        fileId,
        summary: summary || generateFallbackSummary(file),
        tags: tags.length > 0 ? tags : generateFallbackTags(file),
      });

      processedFileIds.add(fileId);
    }

    // Add fallback results for any files not processed
    for (const file of files) {
      if (!processedFileIds.has(file.fileId)) {
        results.push(generateFallbackResult(file));
      }
    }

    return results;
  } catch (error) {
    console.error('[SummaryTagAgent] Failed to parse batch response, falling back to individual processing:', error);
    // If fallback processor is provided, use it; otherwise return fallback results for all files
    if (fallbackProcessor) {
      return await fallbackProcessor(files);
    }
    return files.map(f => generateFallbackResult(f));
  }
}
