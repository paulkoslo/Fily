/**
 * OptimizerAgent - Response Parsing
 * 
 * Parses LLM JSON responses from optimizer API calls into structured results.
 * Handles both optimizations (file placements) and new folders (if created).
 * 
 * Workflow Context:
 * - parseOptimizationResponse: Parses batch optimizer responses
 * - Extracts: optimizations[] (file placements) and newFolders[] (optional)
 * - Called by: OptimizerAgent.processBatch() after LLM API call
 * - Validates confidence scores (clamps to 0.0-1.0 range)
 * 
 * This module converts LLM output into OptimizerResult[] used to improve file placements.
 */
import type { OptimizerResult, OptimizerNewFolder } from './types';

/**
 * Parse optimizer response from LLM
 */
export function parseOptimizationResponse(
  content: string
): { optimizations: OptimizerResult[]; newFolders?: OptimizerNewFolder[] } | null {
  if (!content) return null;

  let jsonText = content.trim();

  // Strip markdown code fences if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-zA-Z]*\s*/u, '');
    jsonText = jsonText.replace(/```$/u, '').trim();
  }

  // Find first "{" and last "}" to isolate JSON object
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.warn('[OptimizerAgent] Could not find JSON object braces in model response');
    return null;
  }
  jsonText = jsonText.slice(firstBrace, lastBrace + 1);

  try {
    const value = JSON.parse(jsonText) as any;
    if (!value || typeof value !== 'object') return null;

    const optimizations = Array.isArray(value.optimizations) ? value.optimizations : [];
    const newFolders = Array.isArray(value.newFolders) ? value.newFolders : [];

    const parsed: { optimizations: OptimizerResult[]; newFolders?: OptimizerNewFolder[] } = {
      optimizations: optimizations.map((opt: any) => ({
        fileId: String(opt.fileId),
        virtualPath: String(opt.virtualPath),
        confidence:
          typeof opt.confidence === 'number'
            ? Math.max(0, Math.min(1, opt.confidence))
            : 0.5,
        reason: String(opt.reason ?? 'Optimized placement'),
      })),
      newFolders: newFolders.length > 0 ? newFolders.map((f: any) => ({
        path: String(f.path ?? ''),
        description: String(f.description ?? ''),
      })) : undefined,
    };

    return parsed;
  } catch (error) {
    console.error('[OptimizerAgent] JSON parse error:', error);
    return null;
  }
}
