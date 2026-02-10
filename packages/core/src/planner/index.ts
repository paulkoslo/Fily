import type { FileRecord, PlannerOutput } from '../ipc/contracts';

/**
 * Planner interface - the contract that all planners must implement.
 * 
 * Current implementation: StubPlanner (rule-based, instant)
 * Future implementation: LlamaFSPlanner (AI-powered, async, out-of-process)
 */
export interface Planner {
  /**
   * Unique identifier for this planner.
   */
  readonly id: string;

  /**
   * Version string for tracking which planner produced which outputs.
   */
  readonly version: string;

  /**
   * Generate virtual placement decisions for the given files.
   * 
   * @param files - Array of file records to plan
   * @returns Promise resolving to array of planner outputs
   */
  plan(files: FileRecord[]): Promise<PlannerOutput[]>;

  /**
   * Cancel any in-progress planning operation.
   * Optional - not all planners support cancellation.
   */
  cancel?(): Promise<void>;
}

export { StubPlanner } from './stub-planner';
export { TaxonomyPlanner } from './taxonomy-planner';
