import {
  TAG_AGENT_SYSTEM_PROMPT,
  TAG_AGENT_USER_PROMPT,
} from './prompts/tag-agent-prompt';
import type { WorkerPool } from './worker-pool';
import { executeApiCall } from './api-call-helper';
import { createLLMClient, getProviderDisplayName, type LLMClient } from './llm-client';

/**
 * Tag Agent
 * 
 * Generates tags for file management based on:
 * - File location/path
 * - Summary (from Summary Agent)
 * - Metadata
 * 
 * Does NOT use the full file content - only summary and metadata.
 * Each API call counts as 1 worker in the worker pool.
 * 
 * Supports both OpenRouter and OpenAI through the unified LLMClient.
 */
export class TagAgent {
  private llmClient: LLMClient | null = null;
  private workerPool: WorkerPool | null = null;

  constructor(workerPool?: WorkerPool) {
    this.llmClient = createLLMClient();
    if (this.llmClient) {
      console.log(`[TagAgent] Using ${getProviderDisplayName(this.llmClient.getProvider())} with model: ${this.llmClient.getModel()}`);
    }
    this.workerPool = workerPool || null;
  }

  /**
   * Generate tags for a file
   */
  async generateTags(
    filePath: string,
    fileName: string,
    extension: string,
    summary: string,
    metadata?: Record<string, any>
  ): Promise<string[]> {
    const trimmedSummary = summary?.trim() ?? '';
    if (trimmedSummary.length === 0) {
      // No model available or no summary → pure heuristic tags
      return this.generateFallbackTags(filePath, fileName, extension, metadata);
    }

    const fallback = () => this.generateFallbackTags(filePath, fileName, extension, metadata);

    const messages = [
      {
        role: 'system' as const,
        content: TAG_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: TAG_AGENT_USER_PROMPT(filePath, fileName, extension, summary, metadata),
      },
    ];

    const result = await executeApiCall<string | string[]>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient
    );

    if (Array.isArray(result)) {
      return result;
    }

    const content = result?.trim();
    if (!content) {
      return fallback();
    }

    try {
      let jsonStr = content;
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }
      if (jsonStr.startsWith('[') && jsonStr.endsWith(']')) {
        const tags = JSON.parse(jsonStr) as string[];
        if (Array.isArray(tags) && tags.every(t => typeof t === 'string')) {
          const normalized = tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
          if (normalized.length > 0) {
            if (normalized.length < 15) {
              return this.enrichTagsWithHeuristics(normalized, filePath, fileName, extension, metadata);
            }
            return normalized;
          }
        }
      }
    } catch (parseError) {
      return this.extractTagsFromText(content, filePath, fileName, extension, metadata);
    }

    return fallback();
  }

  /**
   * Extract tags from text response if JSON parsing fails
   */
  private extractTagsFromText(
    text: string,
    filePath: string,
    fileName: string,
    extension: string,
    metadata?: Record<string, any>
  ): string[] {
    const tags: string[] = [];
    
    // Try to find array-like patterns
    const arrayMatch = text.match(/\[(.*?)\]/);
    if (arrayMatch) {
      const content = arrayMatch[1];
      const items = content.split(',').map(s => s.trim().replace(/['"]/g, ''));
      tags.push(...items.filter(item => item.length > 0));
    }
    
    // Fallback: extract quoted strings
    const quotedMatches = text.match(/"([^"]+)"/g);
    if (quotedMatches) {
      quotedMatches.forEach(match => {
        const tag = match.replace(/"/g, '').toLowerCase().trim();
        if (tag.length > 0) {
          tags.push(tag);
        }
      });
    }
    
    if (tags.length === 0) {
      return this.generateFallbackTags(filePath, fileName, extension, metadata);
    }

    // If parsing text-based tags yields just a few, enrich them with heuristics
    const normalized = tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
    if (normalized.length < 15) {
      return this.enrichTagsWithHeuristics(normalized, filePath, fileName, extension, metadata);
    }

    return Array.from(new Set(normalized));
  }

  /**
   * Generate fallback tags when AI is unavailable or fails
   * Emphasizes location-based tags from file path
   */
  private generateFallbackTags(
    filePath: string,
    fileName: string,
    extension: string,
    metadata?: Record<string, any>
  ): string[] {
    // Start with no base tags and let the enrichment logic build everything
    return this.enrichTagsWithHeuristics([], filePath, fileName, extension, metadata);
  }

  /**
   * Merge model tags with strong heuristics from path, filename and metadata
   * to reach a rich set of tags (ideally 15–25).
   */
  private enrichTagsWithHeuristics(
    baseTags: string[],
    filePath: string,
    fileName: string,
    extension: string,
    metadata?: Record<string, any>
  ): string[] {
    const tags = new Set<string>();

    // Start with any model-provided tags
    for (const tag of baseTags) {
      if (tag && tag.trim().length > 0) {
        tags.add(tag.toLowerCase().trim());
      }
    }

    // 1) Extension
    if (extension) {
      tags.add(extension.toLowerCase());
    }

    // 2) Path segments (location context)
    const rawParts = filePath.split(/[\\/]/).filter(Boolean);
    for (const part of rawParts) {
      const cleaned = part
        .toLowerCase()
        .replace(/\.[^/.]+$/, '') // strip extension if any
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (cleaned.length > 1 && cleaned.length < 40) {
        tags.add(cleaned);
      }
    }

    // 3) File name parts (without extension)
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    const nameParts = nameWithoutExt
      .split(/[-_\s]+/)
      .map(part => part.toLowerCase().trim())
      .filter(part => part.length > 1 && part.length < 40);
    for (const part of nameParts) {
      const cleaned = part.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (cleaned.length > 1) {
        tags.add(cleaned);
      }
    }

    // 4) Simple date/year extraction from path + filename
    const combined = `${filePath} ${fileName}`;
    const yearMatches = combined.match(/\b(19[5-9]\d|20[0-4]\d|2050|2051|2052|2053|2054|2055|2056|2057|2058|2059|20[6-9]\d)\b/g);
    if (yearMatches) {
      yearMatches.forEach(y => tags.add(y));
    }
    const rangeMatches = combined.match(/\b(19[5-9]\d|20[0-9]\d)\s*[-–]\s*(19[5-9]\d|20[0-9]\d)\b/g);
    if (rangeMatches) {
      rangeMatches.forEach(r => tags.add(r.replace(/\s+/g, '')));
    }

    // 5) Metadata-driven tags
    if (metadata) {
      if (metadata.contentType && typeof metadata.contentType === 'string') {
        tags.add(String(metadata.contentType).toLowerCase());
      }
      if (metadata.sheetNames && Array.isArray(metadata.sheetNames)) {
        metadata.sheetNames.forEach((sheet: string) => {
          const cleaned = sheet.toLowerCase().trim().replace(/\s+/g, '-');
          if (cleaned.length > 1) {
            tags.add(cleaned);
          }
        });
      }
      if (metadata.title && typeof metadata.title === 'string') {
        const parts = String(metadata.title)
          .toLowerCase()
          .split(/[-_\s]+/)
          .filter((p: string) => p.length > 1 && p.length < 40);
        parts.forEach((p: string) => tags.add(p.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
      }
      if (metadata.author && typeof metadata.author === 'string') {
        const cleaned = String(metadata.author)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]+/g, '')
          .replace(/^-+|-+$/g, '');
        if (cleaned.length > 1) {
          tags.add(cleaned);
        }
      }
      if (metadata.subject && typeof metadata.subject === 'string') {
        const parts = String(metadata.subject)
          .toLowerCase()
          .split(/[-_\s]+/)
          .filter((p: string) => p.length > 1 && p.length < 40);
        parts.forEach((p: string) => tags.add(p.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
      }
    }

    const all = Array.from(tags);

    // Aim for 15–25 tags, but don't invent nonsense if there's not enough signal
    if (all.length > 25) {
      return all.slice(0, 25);
    }
    return all;
  }
}
