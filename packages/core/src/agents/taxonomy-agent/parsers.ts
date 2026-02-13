/**
 * TaxonomyAgent - Response Parsing
 * 
 * Parses LLM JSON responses into TaxonomyPlan objects (folders + rules).
 * Handles common LLM errors: markdown fences, trailing commas, unescaped newlines.
 * 
 * Workflow Context:
 * - parsePlan: Main parser used by all TaxonomyAgent methods (single-pass, top-level, sub-level)
 * - normalizeFolderPath: Ensures paths start with "/" and have no trailing slash
 * - repairJson: Fixes common JSON mistakes before parsing
 * - Called after: LLM API responses in generatePlan(), generateTopLevelPlan(), generateSubLevelPlan()
 * 
 * This module converts LLM output into the TaxonomyPlan structure used by the planner.
 */
import type { TaxonomyPlan } from '../../planner/taxonomy-types';

/**
 * Ensure path starts with / and has no trailing slash (avoids malformed virtual_path).
 */
export function normalizeFolderPath(path: string): string {
  const p = path.trim().replace(/\\/g, '/');
  if (!p) return '/Other';
  const withLeading = p.startsWith('/') ? p : '/' + p;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

/**
 * Try to repair common LLM JSON mistakes: trailing commas, unescaped newlines in strings.
 */
export function repairJson(jsonText: string): string {
  // Remove trailing commas before } or ] (common LLM mistake)
  let out = jsonText.replace(/,(\s*[}\]])/g, '$1');

  // Replace unescaped newlines inside double-quoted strings (LLMs often insert real newlines)
  let inString = false;
  let escape = false;
  let quote: string | null = null;
  const result: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (escape) {
      result.push(c);
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      result.push(c);
      escape = true;
      continue;
    }
    if ((c === '"' || c === "'") && !escape) {
      if (!inString) {
        inString = true;
        quote = c;
        result.push(c);
      } else if (c === quote) {
        inString = false;
        quote = null;
        result.push(c);
      } else {
        result.push(c);
      }
      continue;
    }
    if (inString && (c === '\n' || c === '\r')) {
      result.push(' ');
      continue;
    }
    result.push(c);
  }
  return result.join('');
}

/**
 * Parse a model response into a TaxonomyPlan.
 * Handles optional markdown fences, validates basic structure, and attempts JSON repair on failure.
 */
export function parsePlan(content: string): TaxonomyPlan | null {
  if (!content) return null;

  let jsonText = content.trim();

  // Strip markdown code fences if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-zA-Z]*\s*/u, '');
    jsonText = jsonText.replace(/```$/u, '').trim();
  }

  // Heuristic: find first "{" and last "}" to isolate JSON object
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.warn(
      '[TaxonomyAgent] Could not find JSON object braces in model response when parsing TaxonomyPlan.'
    );
    return null;
  }
  jsonText = jsonText.slice(firstBrace, lastBrace + 1);

  const tryParse = (text: string): TaxonomyPlan | null => {
    try {
      const value = JSON.parse(text) as any;
      if (!value || typeof value !== 'object') return null;

      const folders = Array.isArray(value.folders) ? value.folders : [];
      const rules = Array.isArray(value.rules) ? value.rules : [];

      const plan: TaxonomyPlan = {
        folders: folders.map((f: any) => ({
          id: String(f.id).trim(),
          path: normalizeFolderPath(String(f.path ?? '')),
          description: String(f.description ?? ''),
        })),
        rules: rules.map((r: any) => ({
          id: String(r.id).trim(),
          targetFolderId: String(r.targetFolderId).trim(),
          requiredTags: Array.isArray(r.requiredTags)
            ? r.requiredTags.map((t: any) => String(t))
            : undefined,
          forbiddenTags: Array.isArray(r.forbiddenTags)
            ? r.forbiddenTags.map((t: any) => String(t))
            : undefined,
          pathContains: Array.isArray(r.pathContains)
            ? r.pathContains.map((p: any) => String(p))
            : undefined,
          extensionIn: Array.isArray(r.extensionIn)
            ? r.extensionIn.map((e: any) => String(e).toLowerCase())
            : undefined,
          summaryContainsAny: Array.isArray(r.summaryContainsAny)
            ? r.summaryContainsAny.map((s: any) => String(s))
            : undefined,
          priority:
            typeof r.priority === 'number'
              ? r.priority
              : Number.parseInt(String(r.priority ?? '0'), 10) || 0,
          reasonTemplate: String(r.reasonTemplate ?? ''),
        })),
      };
      return plan;
    } catch (error) {
      return null;
    }
  };

  let plan = tryParse(jsonText);
  if (plan) return plan;

  const repaired = repairJson(jsonText);
  plan = tryParse(repaired);
  if (plan) {
    console.log('[TaxonomyAgent] Parsed taxonomy after repairing JSON (trailing commas or unescaped newlines).');
    return plan;
  }

  try {
    JSON.parse(jsonText);
  } catch (firstError) {
    console.error(
      '[TaxonomyAgent] JSON parse error while reading TaxonomyPlan from model response (parse failed before and after repair):',
      firstError
    );
  }
  return null;
}
