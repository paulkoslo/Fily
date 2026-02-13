/**
 * Adaptive taxonomy complexity based on file count.
 * More files → more passes and deeper folder structure.
 */

export type TaxonomyStrategy = {
  /** Single pass (current behavior) vs multi-level hierarchical */
  mode: 'single' | 'hierarchical';
  /** Max depth of folder tree: 1 = flat/single pass, 2 = top + one sub-level, 3 = up to three levels */
  maxDepth: 1 | 2 | 3;
  /** Target number of top-level (root) folders for hierarchical mode */
  topLevelFolderCount: number;
  /** Only create subfolders under a branch when it has at least this many files (avoids forced splits) */
  minFilesForSubLevel: number;
  /** Only recurse to third level when a branch has at least this many files */
  minFilesForThirdLevel: number;
  /** Overview size: max tags to include (scales with file count) */
  maxTags: number;
  /** Samples per tag in overview */
  samplesPerTag: number;
};

const SMALL = 600;
const MEDIUM = 1800;
const LARGE = 4000;

/**
 * Returns a taxonomy strategy based on file count.
 * - &lt; 600: single pass, simple tree.
 * - 600–1800: 2-level hierarchical (top + one sub-level per branch).
 * - 1800–4000: 3-level hierarchical, more top-level folders.
 * - 4000+: 3-level with maximum richness (more tags, samples).
 */
export function getTaxonomyStrategy(fileCount: number): TaxonomyStrategy {
  if (fileCount < SMALL) {
    return {
      mode: 'single',
      maxDepth: 1,
      topLevelFolderCount: 0,
      minFilesForSubLevel: 0,
      minFilesForThirdLevel: 0,
      maxTags: 30,
      samplesPerTag: 15,
    };
  }

  if (fileCount < MEDIUM) {
    return {
      mode: 'hierarchical',
      maxDepth: 2,
      topLevelFolderCount: 6,
      minFilesForSubLevel: 25,
      minFilesForThirdLevel: 0,
      maxTags: 50,
      samplesPerTag: 20,
    };
  }

  if (fileCount < LARGE) {
    return {
      mode: 'hierarchical',
      maxDepth: 3,
      topLevelFolderCount: 8,
      minFilesForSubLevel: 20,
      minFilesForThirdLevel: 80,
      maxTags: 60,
      samplesPerTag: 25,
    };
  }

  return {
    mode: 'hierarchical',
    maxDepth: 3,
    topLevelFolderCount: 12,
    minFilesForSubLevel: 15,
    minFilesForThirdLevel: 60,
    maxTags: 80,
    samplesPerTag: 20,
  };
}
