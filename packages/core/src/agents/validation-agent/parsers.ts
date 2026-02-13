/**
 * ValidationAgent - Response Parsing
 * 
 * Parses LLM JSON responses from validation API calls into structured ValidationResult.
 * Extracts issues, corrected folders/rules, and files needing optimization.
 * 
 * Workflow Context:
 * - parseValidationResult: Parses validation API responses
 * - Extracts: issues[], correctedFolders[], correctedRules[], filesNeedingOptimization[]
 * - Called by: ValidationAgent.validatePlan() after LLM API call
 * - Used to: Fix logical errors in taxonomy plans before file placement
 * 
 * This module converts LLM validation output into corrections applied by TaxonomyPlanner.
 */
import type { ValidationResult } from '../prompts/validation-agent-prompt';

/**
 * Parse validation result from LLM response.
 */
export function parseValidationResult(content: string): ValidationResult | null {
  if (!content) return null;

  let jsonText = content.trim();

  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-zA-Z]*\s*/u, '');
    jsonText = jsonText.replace(/```$/u, '').trim();
  }

  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  jsonText = jsonText.slice(firstBrace, lastBrace + 1);

  try {
    const value = JSON.parse(jsonText) as any;
    if (!value || typeof value !== 'object') return null;

    return {
      issues: Array.isArray(value.issues)
        ? value.issues.map((i: any) => ({
            type: String(i.type),
            severity: String(i.severity),
            description: String(i.description ?? ''),
            affectedFolderIds: Array.isArray(i.affectedFolderIds)
              ? i.affectedFolderIds.map((id: any) => String(id))
              : [],
            affectedRuleIds: Array.isArray(i.affectedRuleIds)
              ? i.affectedRuleIds.map((id: any) => String(id))
              : [],
          }))
        : [],
      correctedFolders: Array.isArray(value.correctedFolders)
        ? value.correctedFolders.map((f: any) => ({
            id: String(f.id),
            path: String(f.path),
            description: String(f.description ?? ''),
          }))
        : [],
      correctedRules: Array.isArray(value.correctedRules)
        ? value.correctedRules.map((r: any) => ({
            id: String(r.id),
            targetFolderId: String(r.targetFolderId),
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
          }))
        : [],
      filesNeedingOptimization: Array.isArray(value.filesNeedingOptimization)
        ? value.filesNeedingOptimization.map((f: any) => ({
            fileId: String(f.fileId),
            reason: String(f.reason ?? ''),
          }))
        : [],
    };
  } catch (error) {
    console.error('[ValidationAgent] JSON parse error:', error);
    return null;
  }
}
