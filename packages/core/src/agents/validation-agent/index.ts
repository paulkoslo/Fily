/**
 * ValidationAgent - Main Orchestrator
 * 
 * Validates LLM-generated taxonomy plans and fixes logical errors.
 * Detects generic folder names, broken references, and structural issues.
 * 
 * Workflow Context:
 * - validatePlan(): Main entry point - checks taxonomy plan for issues
 * - Called by: TaxonomyPlanner (after taxonomy generation, before file placement)
 * - Detects: Generic names, broken rule→folder refs, too flat/deep structure
 * - applyCorrections(): Replaces faulty folders/rules with corrected versions
 * - Output: Corrected plan + list of files needing optimization
 * 
 * This agent ensures taxonomy quality by catching and fixing LLM mistakes before placement.
 */
import type { TaxonomyPlan, VirtualFolderSpec, PlacementRule } from '../../planner/taxonomy-types';
import type { TaxonomyOverview } from '../../planner/taxonomy-overview';
import type { FileCard } from '../../ipc/contracts';
import {
  VALIDATION_AGENT_SYSTEM_PROMPT,
  buildValidationPrompt,
  type ValidationResult,
} from '../prompts/validation-agent-prompt';
import type { WorkerPool } from '../worker-pool';
import { executeApiCall } from '../api-call-helper';
import { createLLMClient, type LLMClient } from '../llm-client';
import { parseValidationResult } from './parsers';

/**
 * Validation Agent
 * 
 * Validates LLM-generated taxonomy plans and fixes logical errors:
 * - Generic folder names (Misc, Personal, Other at top level)
 * - Broken rule→folder references
 * - Illogical structure (too flat, too deep)
 * - Vague folder names
 * 
 * Returns corrected plan parts and list of files needing optimization.
 */
export class ValidationAgent {
  private llmClient: LLMClient | null;
  private workerPool: WorkerPool | null;

  constructor(workerPool?: WorkerPool) {
    this.llmClient = createLLMClient();
    if (!this.llmClient) {
      console.warn(
        '[ValidationAgent] No LLM API key configured – validation will be skipped. ' +
          'Set OPENROUTER_API_KEY or OPENAI_API_KEY to enable validation.'
      );
    }
    this.workerPool = workerPool || null;
  }

  /**
   * Validate a taxonomy plan and return corrections.
   * 
   * @param plan - The taxonomy plan to validate
   * @param overview - Overview of files used to generate the plan
   * @param fileCards - File cards for context
   * @param onProgress - Optional progress callback
   * @returns Validation result with issues, corrections, and files needing optimization
   */
  async validatePlan(
    plan: TaxonomyPlan,
    overview: TaxonomyOverview,
    fileCards: FileCard[],
    onProgress?: (message: string) => void
  ): Promise<ValidationResult> {
    if (!this.llmClient) {
      return {
        issues: [],
        correctedFolders: [],
        correctedRules: [],
        filesNeedingOptimization: [],
      };
    }

    onProgress?.('Validating taxonomy plan for logical errors...');

    const system = VALIDATION_AGENT_SYSTEM_PROMPT;
    const user = buildValidationPrompt(plan, overview, fileCards);

    const fallback = () => ({
      issues: [],
      correctedFolders: [],
      correctedRules: [],
      filesNeedingOptimization: [],
    });

    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];

    const result = await executeApiCall<string | ValidationResult>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient,
      {
        reason: 'Taxonomy plan validation',
        maxTokens: 16384,
      }
    );

    if (typeof result !== 'string') {
      return result;
    }

    const raw = result.trim();
    if (!raw) {
      console.warn('[ValidationAgent] Empty response – assuming no issues.');
      return fallback();
    }

    const parsed = parseValidationResult(raw);
    if (!parsed) {
      console.warn('[ValidationAgent] Failed to parse validation result – assuming no issues.');
      return fallback();
    }

    if (parsed.issues.length > 0) {
      console.log(
        `[ValidationAgent] Found ${parsed.issues.length} issue(s): ${parsed.issues.map((i) => i.type).join(', ')}`
      );
    }

    return parsed;
  }

  /**
   * Apply corrections to a plan: replace faulty folders/rules with corrected ones.
   * 
   * @param plan - Original plan
   * @param corrections - Validation result with corrections
   * @returns Corrected plan
   */
  applyCorrections(plan: TaxonomyPlan, corrections: ValidationResult): TaxonomyPlan {
    const correctedFolderIds = new Set(corrections.correctedFolders.map((f) => f.id));
    const correctedRuleIds = new Set(corrections.correctedRules.map((r) => r.id));

    const folders: VirtualFolderSpec[] = [
      ...plan.folders.filter((f) => !correctedFolderIds.has(f.id)),
      ...corrections.correctedFolders.map((f) => ({
        id: f.id,
        path: f.path,
        description: f.description,
      })),
    ];

    const rules: PlacementRule[] = [
      ...plan.rules.filter((r) => !correctedRuleIds.has(r.id)),
      ...corrections.correctedRules.map((r) => ({
        id: r.id,
        targetFolderId: r.targetFolderId,
        requiredTags: r.requiredTags,
        forbiddenTags: r.forbiddenTags,
        pathContains: r.pathContains,
        extensionIn: r.extensionIn,
        summaryContainsAny: r.summaryContainsAny,
        priority: r.priority,
        reasonTemplate: r.reasonTemplate,
      })),
    ];

    return { folders, rules };
  }
}
