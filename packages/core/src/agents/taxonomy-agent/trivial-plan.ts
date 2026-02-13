/**
 * TaxonomyAgent - Trivial Plan Builder
 * 
 * Generates a fallback taxonomy plan when LLM is unavailable or API calls fail.
 * Creates a simple "/All Files" folder with a catch-all rule.
 * 
 * Workflow Context:
 * - Used when: No LLM API key configured, API errors, or empty responses
 * - Called by: TaxonomyAgent.generatePlan(), generateTopLevelPlan(), generateSubLevelPlan()
 * - Ensures taxonomy pipeline always produces a valid plan (even if trivial)
 * 
 * This fallback ensures the virtual tree builder always has a valid plan to work with.
 */
import type { TaxonomyPlan } from '../../planner/taxonomy-types';

/**
 * Build a trivial fallback plan when LLM is unavailable
 */
export function buildTrivialPlan(): TaxonomyPlan {
  return {
    folders: [
      {
        id: 'all-files',
        path: '/All Files',
        description: 'Fallback virtual folder that contains every file when no taxonomy is available.',
      },
    ],
    rules: [
      {
        id: 'catch-all',
        targetFolderId: 'all-files',
        requiredTags: [],
        forbiddenTags: [],
        pathContains: [],
        extensionIn: [],
        summaryContainsAny: [],
        priority: 1,
        reasonTemplate: 'Placed in /All Files by fallback taxonomy rule.',
      },
    ],
  };
}
