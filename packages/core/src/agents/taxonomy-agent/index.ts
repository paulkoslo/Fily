/**
 * TaxonomyAgent - Main Orchestrator
 * 
 * Generates virtual folder structures and placement rules using LLM.
 * Supports both single-pass (simple) and hierarchical (multi-level) taxonomy generation.
 * 
 * Workflow Context:
 * - generatePlan(): Single-pass full taxonomy (used for < 600 files)
 * - generateTopLevelPlan(): Root folders only (used by hierarchical orchestrator)
 * - generateSubLevelPlan(): Child folders under parent (used by hierarchical orchestrator)
 * - Called by: TaxonomyPlanner → TaxonomyOrchestrator (for hierarchical mode)
 * - Output: TaxonomyPlan (folders + rules) → used by rule matcher → produces PlannerOutput[]
 * 
 * This agent designs the virtual folder structure that organizes files intelligently.
 * All LLM calls go through WorkerPool for parallel processing.
 */
import type { TaxonomyOverview } from '../../planner/taxonomy-overview';
import type { TaxonomyPlan } from '../../planner/taxonomy-types';
import type { TaxonomyStrategy } from '../../planner/taxonomy-strategy';
import {
  TAXONOMY_AGENT_SYSTEM_PROMPT,
  TAXONOMY_AGENT_USER_PROMPT,
} from '../prompts/taxonomy-agent-prompt';
import {
  TAXONOMY_TOP_LEVEL_SYSTEM_PROMPT,
  TAXONOMY_TOP_LEVEL_USER_PROMPT,
  TAXONOMY_SUB_LEVEL_SYSTEM_PROMPT,
  TAXONOMY_SUB_LEVEL_USER_PROMPT,
} from '../prompts/taxonomy-hierarchical-prompt';
import type { WorkerPool } from '../worker-pool';
import { executeApiCall } from '../api-call-helper';
import { createLLMClient, type LLMClient } from '../llm-client';
import { buildTrivialPlan } from './trivial-plan';
import { parsePlan } from './parsers';

export class TaxonomyAgent {
  private llmClient: LLMClient | null;
  private workerPool: WorkerPool | null;

  constructor(workerPool?: WorkerPool) {
    this.llmClient = createLLMClient();
    if (!this.llmClient) {
      // Make it very obvious in logs when we are NOT using the LLM
      console.warn(
        '[TaxonomyAgent] No LLM API key configured – using trivial /All Files taxonomy plan. ' +
          'Set OPENROUTER_API_KEY or OPENAI_API_KEY in the Electron main process environment to enable AI taxonomy.'
      );
    }
    this.workerPool = workerPool || null;
  }

  async generatePlan(overview: TaxonomyOverview): Promise<TaxonomyPlan> {
    if (!this.llmClient) {
      // No API key available – fall back to a simple, deterministic taxonomy
      return buildTrivialPlan();
    }

    const system = TAXONOMY_AGENT_SYSTEM_PROMPT;
    const user = TAXONOMY_AGENT_USER_PROMPT(overview);

    let usedFallback = false;
    const fallback = () => {
      usedFallback = true;
      return buildTrivialPlan();
    };
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];

    const result = await executeApiCall<string | TaxonomyPlan>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient,
      {
        reason: 'Taxonomy plan (virtual folder structure and rules)',
        maxTokens: 65536, // No practical limit – taxonomy is the most important step; give full room for reasoning and output
      }
    );

    if (typeof result !== 'string') {
      if (usedFallback) {
        console.error(
          '[TaxonomyAgent] Error while calling LLM for taxonomy plan – falling back to trivial /All Files plan.'
        );
      }
      return result;
    }

    const raw = result.trim();

    if (!raw) {
      console.warn(
        '[TaxonomyAgent] Model returned empty content – falling back to trivial /All Files plan.'
      );
      return buildTrivialPlan();
    }

    const parsed = parsePlan(raw);
    if (!parsed) {
      console.warn(
        '[TaxonomyAgent] Failed to parse model response into TaxonomyPlan – falling back to trivial /All Files plan.\n' +
          `First 300 chars of response:\n${raw.slice(0, 300)}`
      );
      return buildTrivialPlan();
    }

    console.log(
      `[TaxonomyAgent] Successfully generated taxonomy with ${parsed.folders.length} folders and ${parsed.rules.length} rules.`
    );
    return parsed;
  }

  /**
   * Generate only top-level (root) folders and rules. Used by hierarchical orchestrator.
   */
  async generateTopLevelPlan(
    overview: TaxonomyOverview,
    strategy: TaxonomyStrategy
  ): Promise<TaxonomyPlan> {
    if (!this.llmClient) return buildTrivialPlan();
    const system = TAXONOMY_TOP_LEVEL_SYSTEM_PROMPT;
    const user = TAXONOMY_TOP_LEVEL_USER_PROMPT(overview, strategy);
    return this.runPlanWithPrompts(system, user, 'top-level');
  }

  /**
   * Generate one level of child folders under a parent path. Used by hierarchical orchestrator.
   */
  async generateSubLevelPlan(
    overview: TaxonomyOverview,
    parentPath: string,
    parentFolderId: string
  ): Promise<TaxonomyPlan> {
    if (!this.llmClient) return buildTrivialPlan();
    const system = TAXONOMY_SUB_LEVEL_SYSTEM_PROMPT;
    const user = TAXONOMY_SUB_LEVEL_USER_PROMPT(overview, parentPath, parentFolderId);
    return this.runPlanWithPrompts(system, user, 'sub-level');
  }

  private async runPlanWithPrompts(
    system: string,
    user: string,
    label: string
  ): Promise<TaxonomyPlan> {
    const fallback = () => buildTrivialPlan();
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];
    const result = await executeApiCall<string | TaxonomyPlan>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient!,
      { reason: `Taxonomy ${label} plan`, maxTokens: 32768 }
    );
    if (typeof result !== 'string') return result;
    const raw = result.trim();
    if (!raw) return buildTrivialPlan();
    const parsed = parsePlan(raw);
    if (!parsed) {
      console.warn(`[TaxonomyAgent] Failed to parse ${label} plan – using trivial plan.`);
      return buildTrivialPlan();
    }
    console.log(
      `[TaxonomyAgent] ${label}: ${parsed.folders.length} folders, ${parsed.rules.length} rules`
    );
    return parsed;
  }
}
