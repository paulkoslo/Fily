/**
 * OptimizerAgent - Main Orchestrator
 * 
 * Re-evaluates files with low confidence scores and suggests better placements.
 * Can create new folders when files don't fit well in existing taxonomy structure.
 * 
 * Workflow Context:
 * - optimizePlacements(): Main entry point - processes low-confidence files in batches
 * - Called by: TaxonomyPlanner (after initial taxonomy generation)
 * - Input: Files with confidence < OPTIMIZER_CONFIDENCE_THRESHOLD (default: 50%)
 * - Output: Improved placements + optional new folders → merged back into PlannerOutput[]
 * - Processes batches in parallel via WorkerPool
 * 
 * This agent fine-tunes the taxonomy by improving placements and creating missing folders.
 */
import type { TaxonomyPlan } from '../../planner/taxonomy-types';
import type { FileCard, PlannerOutput } from '../../ipc/contracts';
import {
  OPTIMIZER_AGENT_SYSTEM_PROMPT,
  buildOptimizerPrompt,
  type OptimizerBatchInput,
} from '../prompts/optimizer-agent-prompt';
import type { WorkerPool } from '../worker-pool';
import { executeApiCall } from '../api-call-helper';
import { createLLMClient, type LLMClient } from '../llm-client';
import { OPTIMIZER_BATCH_SIZE, OPTIMIZER_CONFIDENCE_THRESHOLD } from '../../planner/constants';
import type { OptimizerResult, OptimizerNewFolder } from './types';
import { parseOptimizationResponse } from './parsers';

/**
 * Optimizer Agent
 * 
 * Re-evaluates files with low confidence scores (<OPTIMIZER_CONFIDENCE_THRESHOLD) and suggests better placements.
 * Can create new folders when files don't fit well in existing structure.
 * 
 * Features:
 * - Processes files in batches through WorkerPool
 * - Can create new folders when needed (if files don't fit existing structure)
 * - Provides improved confidence scores and reasoning
 */
export class OptimizerAgent {
  private llmClient: LLMClient | null;
  private workerPool: WorkerPool | null;
  private batchSize: number = OPTIMIZER_BATCH_SIZE;

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
   * @param lowConfidenceFiles - Files with confidence < OPTIMIZER_CONFIDENCE_THRESHOLD and their current placements
   * @param onProgress - Optional progress callback
   * @returns Optimized placements for the files and any new folders created
   */
  async optimizePlacements(
    plan: TaxonomyPlan,
    lowConfidenceFiles: {
      card: FileCard;
      currentPlacement: PlannerOutput;
    }[],
    onProgress?: (message: string) => void
  ): Promise<{ optimizations: OptimizerResult[]; newFolders: OptimizerNewFolder[] }> {
    if (!this.llmClient || lowConfidenceFiles.length === 0) {
      return { optimizations: [], newFolders: [] };
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

    // Flatten results and collect new folders
    const results: OptimizerResult[] = [];
    const newFoldersMap = new Map<string, OptimizerNewFolder>();
    
    for (const batchResult of batchResults) {
      results.push(...batchResult.optimizations);
      // Collect unique new folders (by path)
      for (const folder of batchResult.newFolders) {
        if (!newFoldersMap.has(folder.path)) {
          newFoldersMap.set(folder.path, folder);
        }
      }
    }

    const newFolders = Array.from(newFoldersMap.values());
    
    if (newFolders.length > 0) {
      onProgress?.(`Optimizer: Created ${newFolders.length} new folder(s) for better organization`);
    }
    onProgress?.(`Optimizer: Finished optimizing ${results.length} file placements`);

    return { optimizations: results, newFolders };
  }

  /**
   * Process a single batch of files
   */
  private async processBatch(
    plan: TaxonomyPlan,
    batch: OptimizerBatchInput
  ): Promise<{ optimizations: OptimizerResult[]; newFolders: OptimizerNewFolder[] }> {
    if (!this.llmClient) {
      return { optimizations: [], newFolders: [] };
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
      return { optimizations: fallbackOptimizations, newFolders: [] };
    };

    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];

    try {
      const result = await executeApiCall<string | { optimizations: OptimizerResult[]; newFolders?: OptimizerNewFolder[] }>(
        messages,
        fallback,
        this.workerPool,
        this.llmClient
      );

      if (typeof result !== 'string') {
        // Already parsed as object (shouldn't happen with current implementation, but handle it)
        console.log(`[OptimizerAgent] Received object result with ${result.optimizations?.length || 0} optimizations`);
        return {
          optimizations: result.optimizations || fallbackOptimizations,
          newFolders: result.newFolders || [],
        };
      }

      const raw = result.trim();
      if (!raw) {
        console.warn('[OptimizerAgent] Model returned empty content – using current placements');
        console.warn(`[OptimizerAgent] Raw result type: ${typeof result}, length: ${result?.length || 0}`);
        return { optimizations: fallbackOptimizations, newFolders: [] };
      }

      console.log(`[OptimizerAgent] Received response (${raw.length} chars), first 200 chars: ${raw.slice(0, 200)}`);

      const parsed = parseOptimizationResponse(raw);
      if (!parsed) {
        console.warn(
          '[OptimizerAgent] Failed to parse model response – using current placements.\n' +
            `First 500 chars of response:\n${raw.slice(0, 500)}`
        );
        return { optimizations: fallbackOptimizations, newFolders: [] };
      }

      console.log(`[OptimizerAgent] Successfully parsed ${parsed.optimizations.length} optimizations and ${parsed.newFolders?.length || 0} new folders`);
      return {
        optimizations: parsed.optimizations || fallbackOptimizations,
        newFolders: parsed.newFolders || [],
      };
    } catch (error) {
      console.error('[OptimizerAgent] Error during batch processing:', error);
      return { optimizations: fallbackOptimizations, newFolders: [] };
    }
  }
}

// Re-export types for convenience
export type { OptimizerResult, OptimizerNewFolder } from './types';
