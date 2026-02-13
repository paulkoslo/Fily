import type { FileCard } from '../ipc/contracts';
import type { PlacementRule, VirtualFolderSpec } from './taxonomy-types';

/**
 * Shared rule-matching logic for taxonomy plans.
 * Used by TaxonomyPlanner (apply plan) and TaxonomyOrchestrator (assign files to branches).
 */

export function ruleMatchesWithQuality(
  rule: PlacementRule,
  card: FileCard
): { matches: boolean; matchQuality: number } {
  const tags = (card.tags ?? []).map((t) => t.toLowerCase());
  const tagSet = new Set(tags);
  const path = (card.relative_path ?? card.path).toLowerCase();
  const ext = card.extension.toLowerCase();
  const summary = (card.summary ?? '').toLowerCase();

  let conditionsChecked = 0;
  let conditionsMatched = 0;

  if (rule.requiredTags && rule.requiredTags.length > 0) {
    conditionsChecked++;
    const allPresent = rule.requiredTags.every((raw) => tagSet.has(raw.toLowerCase()));
    if (!allPresent) return { matches: false, matchQuality: 0 };
    conditionsMatched++;
  }

  if (rule.forbiddenTags && rule.forbiddenTags.length > 0) {
    conditionsChecked++;
    const nonePresent = !rule.forbiddenTags.some((raw) => tagSet.has(raw.toLowerCase()));
    if (!nonePresent) return { matches: false, matchQuality: 0 };
    conditionsMatched++;
  }

  if (rule.pathContains && rule.pathContains.length > 0) {
    conditionsChecked++;
    const anyMatch = rule.pathContains.some((p) => {
      const needle = String(p).toLowerCase();
      return needle.length > 0 && path.includes(needle);
    });
    if (!anyMatch) return { matches: false, matchQuality: 0 };
    conditionsMatched++;
  }

  if (rule.extensionIn && rule.extensionIn.length > 0) {
    conditionsChecked++;
    const allowed = rule.extensionIn.map((e) => String(e).toLowerCase());
    if (!allowed.includes(ext)) return { matches: false, matchQuality: 0 };
    conditionsMatched++;
  }

  if (rule.summaryContainsAny && rule.summaryContainsAny.length > 0) {
    conditionsChecked++;
    const anyMatch = rule.summaryContainsAny.some((kw) => {
      const needle = String(kw).toLowerCase();
      return needle.length > 0 && summary.includes(needle);
    });
    if (!anyMatch) return { matches: false, matchQuality: 0 };
    conditionsMatched++;
  }

  if (conditionsChecked === 0) {
    return { matches: true, matchQuality: 0.5 };
  }

  return { matches: true, matchQuality: conditionsMatched / conditionsChecked };
}

export function calculateRuleSpecificity(rule: PlacementRule): number {
  let n = 0;
  if (rule.requiredTags && rule.requiredTags.length > 0) n++;
  if (rule.forbiddenTags && rule.forbiddenTags.length > 0) n++;
  if (rule.pathContains && rule.pathContains.length > 0) n++;
  if (rule.extensionIn && rule.extensionIn.length > 0) n++;
  if (rule.summaryContainsAny && rule.summaryContainsAny.length > 0) n++;
  return Math.min(1, n / 5);
}

/**
 * Returns the best matching rule for a file card, or undefined if none match.
 */
export function findBestRule(
  rules: PlacementRule[],
  card: FileCard
): { rule: PlacementRule; matchQuality: number } | undefined {
  let best: PlacementRule | undefined;
  let bestScore = -Infinity;
  let bestMatchQuality = 0;

  for (const rule of rules) {
    const result = ruleMatchesWithQuality(rule, card);
    if (!result.matches) continue;

    const specificity = calculateRuleSpecificity(rule);
    const score = rule.priority + specificity * 10;

    if (!best || score > bestScore) {
      best = rule;
      bestScore = score;
      bestMatchQuality = result.matchQuality;
    }
  }

  return best ? { rule: best, matchQuality: bestMatchQuality } : undefined;
}

/**
 * For each file card, returns the target folder id and path from the plan (best matching rule).
 * Cards that match no rule get folderId undefined (caller can assign to catch-all).
 */
export function getFileAssignments(
  rules: PlacementRule[],
  folders: VirtualFolderSpec[],
  fileCards: FileCard[]
): Map<string, { folderId: string; folderPath: string }> {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<string, { folderId: string; folderPath: string }>();

  for (const card of fileCards) {
    const match = findBestRule(rules, card);
    if (match) {
      const folder = folderById.get(match.rule.targetFolderId);
      if (folder) {
        out.set(card.file_id, { folderId: folder.id, folderPath: folder.path });
      }
    }
  }

  return out;
}

/**
 * Number of files each rule matches (for coverage analysis and confidence).
 */
export function computeRuleMatchCounts(
  rules: PlacementRule[],
  fileCards: FileCard[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    let n = 0;
    for (const card of fileCards) {
      if (ruleMatchesWithQuality(rule, card).matches) n++;
    }
    counts.set(rule.id, n);
  }
  return counts;
}
