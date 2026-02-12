import type { TaxonomyPlan } from '../planner/taxonomy-types';
import type { FileCard, PlannerOutput } from '../ipc/contracts';
import {
  OPTIMIZER_AGENT_SYSTEM_PROMPT,
  buildOptimizerPrompt,
  type OptimizerBatchInput,
} from './prompts/optimizer-agent-prompt';
import type { WorkerPool } from './worker-pool';
import { executeApiCall } from './api-call-helper';
import { createLLMClient, type LLMClient } from './llm-client';

/**
 * Result from optimizer batch processing
 */
export interface OptimizerResult {
  fileId: string;
  virtualPath: string;
  confidence: number;
  reason: string;
}

/**
 * Optimizer Agent
 * 
 * Re-evaluates files with low confidence scores (<70%) and suggests better placements
 * within the existing taxonomy structure.
 * 
 * Features:
 * - Processes files in batches through WorkerPool
 * - Uses existing taxonomy plan (doesn't create new folders)
 * - Provides improved confidence scores and reasoning
 */
export class OptimizerAgent {
  private llmClient: LLMClient | null;
  private workerPool: WorkerPool | null;
  private batchSize: number = 10; // Process 10 files per batch

  constructor(workerPool?: WorkerPool) {
    this.llmClient = createLLMClient();
    if (!this.llmClient) {
      console.warn(
        '[OptimizerAgent] No LLM API key configured – optimizer will be skipped. ' +
          'Set OPENROUTER_API_KEY or OPENAI_API_KEY in the Electron main process environment to enable optimization.'
      );
    }
    this.workerPool = workerPool || null;
  }

  /**
   * Optimize placements for files with low confidence
   * 
   * @param plan - The taxonomy plan that was already created
   * @param lowConfidenceFiles - Files with confidence < 0.7 and their current placements
   * @param onProgress - Optional progress callback
   * @returns Optimized placements for the files
   */
  async optimizePlacements(
    plan: TaxonomyPlan,
    lowConfidenceFiles: {
      card: FileCard;
      currentPlacement: PlannerOutput;
    }[],
    onProgress?: (message: string) => void
  ): Promise<OptimizerResult[]> {
    if (!this.llmClient || lowConfidenceFiles.length === 0) {
      return [];
    }

    // Split into batches
    const batches: OptimizerBatchInput[] = [];
    for (let i = 0; i < lowConfidenceFiles.length; i += this.batchSize) {
      const batchCards = lowConfidenceFiles.slice(i, i + this.batchSize);
      batches.push({
        fileCards: batchCards.map((item) => item.card),
        currentPlacements: batchCards.map((item) => ({
          fileId: item.currentPlacement.file_id,
          virtualPath: item.currentPlacement.virtual_path,
          confidence: item.currentPlacement.confidence,
          reason: item.currentPlacement.reason,
        })),
      });
    }

    const totalBatches = batches.length;
    onProgress?.(`Optimizer: Processing ${lowConfidenceFiles.length} low-confidence files in ${totalBatches} batch${totalBatches !== 1 ? 'es' : ''}...`);

    // Track completed batches for progress reporting
    let completedBatches = 0;
    const batchPromises = batches.map((batch, index) => {
      const batchNumber = index + 1;
      
      return this.workerPool?.execute(async () => {
        onProgress?.(`Optimizer: Processing batch ${batchNumber}/${totalBatches} (${batch.fileCards.length} files)...`);
        const result = await this.processBatch(plan, batch);
        completedBatches++;
        onProgress?.(`Optimizer: Completed batch ${batchNumber}/${totalBatches} (${completedBatches}/${totalBatches} batches done)`);
        return result;
      }) || (async () => {
        onProgress?.(`Optimizer: Processing batch ${batchNumber}/${totalBatches} (${batch.fileCards.length} files)...`);
        const result = await this.processBatch(plan, batch);
        completedBatches++;
        onProgress?.(`Optimizer: Completed batch ${batchNumber}/${totalBatches} (${completedBatches}/${totalBatches} batches done)`);
        return result;
      })();
    });

    const batchResults = await Promise.all(batchPromises);

    // Flatten results
    const results: OptimizerResult[] = [];
    for (const batchResult of batchResults) {
      results.push(...batchResult);
    }

    onProgress?.(`Optimizer: Finished optimizing ${results.length} file placements`);

    return results;
  }

  /**
   * Process a single batch of files
   */
  private async processBatch(
    plan: TaxonomyPlan,
    batch: OptimizerBatchInput
  ): Promise<OptimizerResult[]> {
    if (!this.llmClient) {
      return [];
    }

    const system = OPTIMIZER_AGENT_SYSTEM_PROMPT;
    const user = buildOptimizerPrompt(plan, batch);

    // Log prompt size for debugging
    const promptSize = (system + user).length;
    console.log(`[OptimizerAgent] Processing batch with ${batch.fileCards.length} files, prompt size: ${promptSize} chars`);

    const fallbackOptimizations = batch.fileCards.map((card, index) => {
      const current = batch.currentPlacements[index];
      return {
        fileId: card.file_id,
        virtualPath: current.virtualPath,
        confidence: current.confidence,
        reason: current.reason,
      };
    });

    const fallback = () => {
      // Return current placements as-is if optimization fails
      console.warn(`[OptimizerAgent] Using fallback for batch with ${batch.fileCards.length} files`);
      return { optimizations: fallbackOptimizations };
    };

    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];

    try {
      const result = await executeApiCall<string | { optimizations: OptimizerResult[] }>(
        messages,
        fallback,
        this.workerPool,
        this.llmClient
      );

      if (typeof result !== 'string') {
        // Already parsed as object (shouldn't happen with current implementation, but handle it)
        console.log(`[OptimizerAgent] Received object result with ${result.optimizations?.length || 0} optimizations`);
        return result.optimizations || fallbackOptimizations;
      }

      const raw = result.trim();
      if (!raw) {
        console.warn('[OptimizerAgent] Model returned empty content – using current placements');
        console.warn(`[OptimizerAgent] Raw result type: ${typeof result}, length: ${result?.length || 0}`);
        return fallbackOptimizations;
      }

      console.log(`[OptimizerAgent] Received response (${raw.length} chars), first 200 chars: ${raw.slice(0, 200)}`);

      const parsed = this.parseOptimizationResponse(raw);
      if (!parsed) {
        console.warn(
          '[OptimizerAgent] Failed to parse model response – using current placements.\n' +
            `First 500 chars of response:\n${raw.slice(0, 500)}`
        );
        return fallbackOptimizations;
      }

      console.log(`[OptimizerAgent] Successfully parsed ${parsed.optimizations.length} optimizations`);
      return parsed.optimizations || fallbackOptimizations;
    } catch (error) {
      console.error('[OptimizerAgent] Error during batch processing:', error);
      return fallbackOptimizations;
    }
  }

  /**
   * Parse optimizer response from LLM
   */
  private parseOptimizationResponse(
    content: string
  ): { optimizations: OptimizerResult[] } | null {
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

      const parsed: { optimizations: OptimizerResult[] } = {
        optimizations: optimizations.map((opt: any) => ({
          fileId: String(opt.fileId),
          virtualPath: String(opt.virtualPath),
          confidence:
            typeof opt.confidence === 'number'
              ? Math.max(0, Math.min(1, opt.confidence))
              : 0.5,
          reason: String(opt.reason ?? 'Optimized placement'),
        })),
      };

      return parsed;
    } catch (error) {
      console.error('[OptimizerAgent] JSON parse error:', error);
      return null;
    }
  }
}
