import type { FileCard } from '../ipc/contracts';
import type { TaxonomyPlan, PlacementRule, VirtualFolderSpec } from './taxonomy-types';
import type { TaxonomyStrategy } from './taxonomy-strategy';
import type { TaxonomyAgent } from '../agents/taxonomy-agent';
import { buildTaxonomyOverview } from './taxonomy-overview';
import { getFileAssignments } from './taxonomy-rule-matcher';

const ID_SEP = '--';

function prefixPlan(
  plan: TaxonomyPlan,
  prefix: string
): { folders: VirtualFolderSpec[]; rules: PlacementRule[] } {
  const folders = plan.folders.map((f) => ({
    ...f,
    id: prefix + ID_SEP + f.id,
    path: f.path, // path is already full, e.g. /Work/Invoices
  }));
  const prefixedId = (id: string) => prefix + ID_SEP + id;
  const folderIdByOriginal = new Map(plan.folders.map((f) => [f.id, prefixedId(f.id)]));
  const folderIdByLower = new Map(plan.folders.map((f) => [f.id.toLowerCase(), prefixedId(f.id)]));
  const rules = plan.rules.map((r) => ({
    ...r,
    id: prefix + ID_SEP + r.id,
    targetFolderId:
      folderIdByOriginal.get(r.targetFolderId) ??
      folderIdByLower.get(r.targetFolderId.toLowerCase()) ??
      prefixedId(r.targetFolderId),
  }));
  return { folders, rules };
}

function removeRulesTargetingFolder(rules: PlacementRule[], folderId: string): PlacementRule[] {
  return rules.filter((r) => r.targetFolderId !== folderId);
}

function isLeafFolder(folderPath: string, allFolders: VirtualFolderSpec[]): boolean {
  return !allFolders.some(
    (f) => f.path !== folderPath && f.path.startsWith(folderPath + '/')
  );
}

export type RunPlanOptions = {
  sourceId: number;
  onProgress?: (message: string) => void;
};

/**
 * Runs the taxonomy pipeline: single-pass or hierarchical based on strategy.
 * Returns a single merged TaxonomyPlan.
 */
export async function runTaxonomyPlan(
  fileCards: FileCard[],
  agent: TaxonomyAgent,
  strategy: TaxonomyStrategy,
  options: RunPlanOptions
): Promise<TaxonomyPlan> {
  const { sourceId, onProgress } = options;

  if (strategy.mode === 'single') {
    onProgress?.('Building taxonomy (single pass)...');
    const overview = buildTaxonomyOverview(sourceId, fileCards, {
      maxTags: strategy.maxTags,
      samplesPerTag: strategy.samplesPerTag,
    });
    return agent.generatePlan(overview);
  }

  // Hierarchical: top level then sub-levels
  onProgress?.('Building taxonomy (top level)...');
  const overview = buildTaxonomyOverview(sourceId, fileCards, {
    maxTags: strategy.maxTags,
    samplesPerTag: strategy.samplesPerTag,
  });

  const topPlan = await agent.generateTopLevelPlan(overview, strategy);
  const assignments = getFileAssignments(topPlan.rules, topPlan.folders, fileCards);

  let mergedFolders: VirtualFolderSpec[] = [...topPlan.folders];
  let mergedRules: PlacementRule[] = [...topPlan.rules];

  const fileCardsByFolderId = new Map<string, FileCard[]>();
  for (const card of fileCards) {
    const a = assignments.get(card.file_id);
    if (a) {
      const list = fileCardsByFolderId.get(a.folderId) ?? [];
      list.push(card);
      fileCardsByFolderId.set(a.folderId, list);
    }
  }

  // Collect all subfolder generation tasks (parallel processing via worker pool)
  const subfolderTasks: Array<Promise<{ folder: VirtualFolderSpec; subFolders: VirtualFolderSpec[]; subRules: PlacementRule[] }>> = [];
  
  for (const folder of topPlan.folders) {
    const subset = fileCardsByFolderId.get(folder.id) ?? [];
    if (subset.length === 0) continue;
    // Only subdivide when the branch has enough files; small branches stay as a single folder
    if (subset.length < strategy.minFilesForSubLevel) continue;

    // Create task for parallel execution (worker pool will handle concurrency)
    const task = (async () => {
      onProgress?.(`Building sub-folders under ${folder.path} (${subset.length} files)...`);
      const subOverview = buildTaxonomyOverview(sourceId, subset, {
        maxTags: strategy.maxTags,
        samplesPerTag: Math.min(strategy.samplesPerTag, Math.max(5, Math.floor(subset.length / 10))),
      });
      const subPlan = await agent.generateSubLevelPlan(subOverview, folder.path, folder.id);
      const { folders: subFolders, rules: subRules } = prefixPlan(subPlan, folder.id);
      return { folder, subFolders, subRules };
    })();
    
    subfolderTasks.push(task);
  }

  // Execute all subfolder generations in parallel (worker pool manages concurrency)
  const subfolderResults = await Promise.all(subfolderTasks);

  // Merge results after all subfolders are generated
  for (const { folder, subFolders, subRules } of subfolderResults) {
    mergedRules = removeRulesTargetingFolder(mergedRules, folder.id);
    mergedFolders.push(...subFolders);
    mergedRules.push(...subRules);
  }

  // Optional third level when maxDepth === 3 and branch has enough files
  if (
    strategy.maxDepth === 3 &&
    strategy.minFilesForThirdLevel > 0
  ) {
    const assignments2 = getFileAssignments(mergedRules, mergedFolders, fileCards);
    const countByFolderId = new Map<string, number>();
    for (const [, a] of assignments2) {
      countByFolderId.set(a.folderId, (countByFolderId.get(a.folderId) ?? 0) + 1);
    }

    const leafFolders = mergedFolders.filter((f) =>
      isLeafFolder(f.path, mergedFolders)
    );
    const toRecurse = leafFolders.filter(
      (f) => (countByFolderId.get(f.id) ?? 0) >= strategy.minFilesForThirdLevel
    );

    // Collect all third-level subfolder generation tasks (parallel processing via worker pool)
    const thirdLevelTasks: Array<Promise<{ folder: VirtualFolderSpec; subFolders: VirtualFolderSpec[]; subRules: PlacementRule[] }>> = [];
    
    for (const folder of toRecurse) {
      const subset = fileCards.filter((c) => assignments2.get(c.file_id)?.folderId === folder.id);
      if (subset.length === 0) continue;

      // Create task for parallel execution (worker pool will handle concurrency)
      const task = (async () => {
        onProgress?.(`Building sub-folders under ${folder.path} (${subset.length} files)...`);
        const subOverview = buildTaxonomyOverview(sourceId, subset, {
          maxTags: strategy.maxTags,
          samplesPerTag: Math.min(strategy.samplesPerTag, Math.max(5, Math.floor(subset.length / 10))),
        });
        const subPlan = await agent.generateSubLevelPlan(subOverview, folder.path, folder.id);
        const { folders: subFolders, rules: subRules } = prefixPlan(subPlan, folder.id);
        return { folder, subFolders, subRules };
      })();
      
      thirdLevelTasks.push(task);
    }

    // Execute all third-level subfolder generations in parallel (worker pool manages concurrency)
    const thirdLevelResults = await Promise.all(thirdLevelTasks);

    // Merge results after all third-level subfolders are generated
    for (const { folder, subFolders, subRules } of thirdLevelResults) {
      mergedRules = removeRulesTargetingFolder(mergedRules, folder.id);
      mergedFolders.push(...subFolders);
      mergedRules.push(...subRules);
    }
  }

  return { folders: mergedFolders, rules: mergedRules };
}
