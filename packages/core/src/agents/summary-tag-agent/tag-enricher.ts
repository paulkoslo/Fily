/**
 * SummaryTagAgent - Tag Enrichment
 * 
 * Enriches AI-generated tags with heuristics extracted from file paths, names, and metadata.
 * Ensures every file gets at least SUMMARY_TAG_MIN_TAGS tags for taxonomy matching.
 * 
 * Workflow Context:
 * - Called after LLM generates initial tags (if < SUMMARY_TAG_MIN_TAGS)
 * - Extracts: path segments, filename parts, dates/years, metadata fields
 * - Used by: parsers (after LLM response), fallback (when LLM fails)
 * 
 * This ensures taxonomy rules can match files even if LLM tags are sparse.
 */
import type { FileProcessingInput } from './types';
import { SUMMARY_TAG_MAX_TAGS } from '../../planner/constants';

/**
 * Enrich tags with heuristics (same logic as TagAgent)
 */
export function enrichTagsWithHeuristics(
  baseTags: string[],
  file: FileProcessingInput,
  summary: string
): string[] {
  const tags = new Set<string>();

  // Start with base tags
  for (const tag of baseTags) {
    if (tag && tag.trim().length > 0) {
      tags.add(tag.toLowerCase().trim());
    }
  }

  // Extension
  if (file.extension) {
    tags.add(file.extension.toLowerCase());
  }

  // Path segments
  const rawParts = file.filePath.split(/[\\/]/).filter(Boolean);
  for (const part of rawParts) {
    const cleaned = part
      .toLowerCase()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (cleaned.length > 1 && cleaned.length < 40) {
      tags.add(cleaned);
    }
  }

  // File name parts
  const nameWithoutExt = file.fileName.replace(/\.[^/.]+$/, '');
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

  // Date extraction
  const combined = `${file.filePath} ${file.fileName}`;
  const yearMatches = combined.match(/\b(19[5-9]\d|20[0-4]\d|2050|2051|2052|2053|2054|2055|2056|2057|2058|2059|20[6-9]\d)\b/g);
  if (yearMatches) {
    yearMatches.forEach(y => tags.add(y));
  }
  const rangeMatches = combined.match(/\b(19[5-9]\d|20[0-9]\d)\s*[-–]\s*(19[5-9]\d|20[0-9]\d)\b/g);
  if (rangeMatches) {
    rangeMatches.forEach(r => tags.add(r.replace(/\s+/g, '')));
  }

  // Metadata tags
  if (file.metadata) {
    if (file.metadata.contentType && typeof file.metadata.contentType === 'string') {
      tags.add(String(file.metadata.contentType).toLowerCase());
    }
    if (file.metadata.sheetNames && Array.isArray(file.metadata.sheetNames)) {
      file.metadata.sheetNames.forEach((sheet: string) => {
        const cleaned = String(sheet).toLowerCase().trim().replace(/\s+/g, '-');
        if (cleaned.length > 1) {
          tags.add(cleaned);
        }
      });
    }
    if (file.metadata.title && typeof file.metadata.title === 'string') {
      const parts = String(file.metadata.title)
        .toLowerCase()
        .split(/[-_\s]+/)
        .filter((p: string) => p.length > 1 && p.length < 40);
      parts.forEach((p: string) => tags.add(p.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
    }
    if (file.metadata.author && typeof file.metadata.author === 'string') {
      const cleaned = String(file.metadata.author)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/^-+|-+$/g, '');
      if (cleaned.length > 1) {
        tags.add(cleaned);
      }
    }
    if (file.metadata.subject && typeof file.metadata.subject === 'string') {
      const parts = String(file.metadata.subject)
        .toLowerCase()
        .split(/[-_\s]+/)
        .filter((p: string) => p.length > 1 && p.length < 40);
      parts.forEach((p: string) => tags.add(p.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')));
    }
  }

  const all = Array.from(tags);
  return all.length > SUMMARY_TAG_MAX_TAGS ? all.slice(0, SUMMARY_TAG_MAX_TAGS) : all;
}
