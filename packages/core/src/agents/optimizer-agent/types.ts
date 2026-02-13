/**
 * OptimizerAgent - Type Definitions
 * 
 * Data structures for optimizer results and new folder creation.
 * 
 * Workflow Context:
 * - OptimizerResult: Improved placement for a low-confidence file (from TaxonomyPlanner)
 * - OptimizerNewFolder: New folder created when files don't fit existing structure
 * - Used by: OptimizerAgent.processBatch() → returned to TaxonomyPlanner
 * - Flow: TaxonomyPlanner → OptimizerAgent → OptimizerResult[] → merged back into PlannerOutput[]
 * 
 * These types represent the optimizer's output: better placements and optional new folders.
 */
export interface OptimizerResult {
  fileId: string;
  virtualPath: string;
  confidence: number;
  reason: string;
}

/**
 * New folder created by optimizer (optional)
 */
export interface OptimizerNewFolder {
  path: string;
  description: string;
}
