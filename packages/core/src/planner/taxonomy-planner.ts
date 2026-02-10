import type { Planner } from './index';
import type { FileRecord, PlannerOutput, FileCard } from '../ipc/contracts';
import type { DatabaseManager } from '../db';
import { TaxonomyAgent } from '../agents';
import { buildTaxonomyOverview } from './taxonomy-overview';
import type { TaxonomyPlan, PlacementRule, VirtualFolderSpec } from './taxonomy-types';

export class TaxonomyPlanner implements Planner {
  readonly id = 'taxonomy-planner';
  readonly version = '0.1.0';

  private db: DatabaseManager;
  private agent: TaxonomyAgent;

  constructor(db: DatabaseManager, agent?: TaxonomyAgent) {
    this.db = db;
    this.agent = agent ?? new TaxonomyAgent();
  }

  async plan(files: FileRecord[]): Promise<PlannerOutput[]> {
    if (files.length === 0) return [];

    // For now we assume all files belong to the same source.
    const sourceId = files[0].source_id;

    // 1) Build file cards from DB (includes summary + tags when available)
    const fileCards = await this.db.getFileCardsBySource(sourceId);
    if (fileCards.length === 0) {
      return [];
    }

    // 2) Build aggregate overview for the agent
    const overview = buildTaxonomyOverview(sourceId, fileCards, {
      maxTags: 30,
      samplesPerTag: 5,
    });

    // 3) Ask TaxonomyAgent for a plan
    const plan: TaxonomyPlan = await this.agent.generatePlan(overview);

    // 4) Apply the plan deterministically to produce PlannerOutput[]
    const outputs = this.applyPlanToFiles(plan, fileCards);
    
    return outputs;
  }

  // ---------------------------------------------------------------------------
  // Deterministic rule application
  // ---------------------------------------------------------------------------

  private applyPlanToFiles(plan: TaxonomyPlan, fileCards: FileCard[]): PlannerOutput[] {
    const folderById = new Map<string, VirtualFolderSpec>();
    for (const folder of plan.folders) {
      folderById.set(folder.id, folder);
    }

    // Compute priority range for confidence normalization
    let minPriority = Infinity;
    let maxPriority = -Infinity;
    for (const rule of plan.rules) {
      if (typeof rule.priority === 'number') {
        if (rule.priority < minPriority) minPriority = rule.priority;
        if (rule.priority > maxPriority) maxPriority = rule.priority;
      }
    }
    if (!Number.isFinite(minPriority) || !Number.isFinite(maxPriority)) {
      minPriority = 0;
      maxPriority = 1;
    }

    const outputs: PlannerOutput[] = [];

    for (const card of fileCards) {
      const match = this.findBestRule(plan.rules, card);
      const folder = match ? folderById.get(match.targetFolderId) : undefined;

      // If no rule or folder matched, fall back to a simple catch-all under "/Other"
      const virtualFolderPath = folder?.path || '/Other';
      const rulePriority = match?.priority ?? minPriority;
      const confidence = this.normalizeConfidence(rulePriority, minPriority, maxPriority);

      const reason =
        (match?.reasonTemplate && match.reasonTemplate.trim().length > 0
          ? match.reasonTemplate
          : 'No specific rule matched; placed using generic taxonomy fallback.') + (folder
          ? ` → ${folder.path}`
          : ' → /Other');

      const virtual_path = this.joinVirtualPath(virtualFolderPath, card.name);

      outputs.push({
        file_id: card.file_id,
        virtual_path,
        tags: card.tags ?? [],
        confidence,
        reason,
      });
    }

    return outputs;
  }

  private findBestRule(rules: PlacementRule[], card: FileCard): PlacementRule | undefined {
    let best: PlacementRule | undefined;

    for (const rule of rules) {
      if (!this.ruleMatches(rule, card)) continue;
      if (!best || rule.priority > best.priority) {
        best = rule;
      }
    }

    return best;
  }

  private ruleMatches(rule: PlacementRule, card: FileCard): boolean {
    const tags = (card.tags ?? []).map((t) => t.toLowerCase());
    const tagSet = new Set(tags);
    const path = (card.relative_path ?? card.path).toLowerCase();
    const ext = card.extension.toLowerCase();
    const summary = (card.summary ?? '').toLowerCase();

    // requiredTags: all must be present
    if (rule.requiredTags && rule.requiredTags.length > 0) {
      for (const raw of rule.requiredTags) {
        const t = raw.toLowerCase();
        if (!tagSet.has(t)) {
          return false;
        }
      }
    }

    // forbiddenTags: none may be present
    if (rule.forbiddenTags && rule.forbiddenTags.length > 0) {
      for (const raw of rule.forbiddenTags) {
        const t = raw.toLowerCase();
        if (tagSet.has(t)) {
          return false;
        }
      }
    }

    // pathContains: at least one substring must appear in path
    if (rule.pathContains && rule.pathContains.length > 0) {
      const anyMatch = rule.pathContains.some((p) => {
        const needle = String(p).toLowerCase();
        return needle.length > 0 && path.includes(needle);
      });
      if (!anyMatch) {
        return false;
      }
    }

    // extensionIn: extension must be in the list (case-insensitive)
    if (rule.extensionIn && rule.extensionIn.length > 0) {
      const allowed = rule.extensionIn.map((e) => String(e).toLowerCase());
      if (!allowed.includes(ext)) {
        return false;
      }
    }

    // summaryContainsAny: at least one keyword must appear in summary
    if (rule.summaryContainsAny && rule.summaryContainsAny.length > 0) {
      const anyMatch = rule.summaryContainsAny.some((kw) => {
        const needle = String(kw).toLowerCase();
        return needle.length > 0 && summary.includes(needle);
      });
      if (!anyMatch) {
        return false;
      }
    }

    return true;
  }

  private normalizeConfidence(priority: number, minPriority: number, maxPriority: number): number {
    if (maxPriority <= minPriority) {
      return 0.7;
    }
    const normalized = (priority - minPriority) / (maxPriority - minPriority);
    const clamped = Math.max(0, Math.min(1, normalized));
    // Keep confidence in a comfortable range [0.4, 0.95]
    return 0.4 + clamped * 0.55;
  }

  private joinVirtualPath(folderPath: string, fileName: string): string {
    const base = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
    const safeFileName = fileName.startsWith('/') ? fileName.slice(1) : fileName;
    return `${base}/${safeFileName}`;
  }
}

