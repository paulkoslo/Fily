import type { Planner } from './index';
import type { FileRecord, PlannerOutput, FileCard } from '../ipc/contracts';
import type { DatabaseManager } from '../db';
import { TaxonomyAgent, OptimizerAgent, type WorkerPool } from '../agents';
import { buildTaxonomyOverview } from './taxonomy-overview';
import type { TaxonomyPlan, PlacementRule, VirtualFolderSpec } from './taxonomy-types';

export class TaxonomyPlanner implements Planner {
  readonly id = 'taxonomy-planner';
  readonly version = '0.1.0';

  private db: DatabaseManager;
  private agent: TaxonomyAgent;
  private optimizer: OptimizerAgent | null;
  private onProgress?: (message: string) => void;

  constructor(
    db: DatabaseManager,
    agent?: TaxonomyAgent,
    workerPool?: WorkerPool,
    onProgress?: (message: string) => void
  ) {
    this.db = db;
    this.agent = agent ?? new TaxonomyAgent();
    this.optimizer = workerPool ? new OptimizerAgent(workerPool) : null;
    this.onProgress = onProgress;
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
      maxTags: 50, // Increased to support larger datasets
      samplesPerTag: 20, // Increased to provide more context per tag
    });

    // 3) Ask TaxonomyAgent for a plan
    const plan: TaxonomyPlan = await this.agent.generatePlan(overview);

    // 4) Validate plan quality and log warnings
    this.validatePlan(plan, fileCards);

    // 5) Apply the plan deterministically to produce PlannerOutput[]
    const outputs = this.applyPlanToFiles(plan, fileCards);

    // 6) Optimize low-confidence files (< 70%) if optimizer is available
    if (this.optimizer) {
      const lowConfidenceThreshold = 0.7;
      const lowConfidenceFiles: { card: FileCard; currentPlacement: PlannerOutput }[] = [];

      // Create a map of file_id to FileCard for quick lookup
      const cardMap = new Map<string, FileCard>();
      for (const card of fileCards) {
        cardMap.set(card.file_id, card);
      }

      // Find files with low confidence
      for (const output of outputs) {
        if (output.confidence < lowConfidenceThreshold) {
          const card = cardMap.get(output.file_id);
          if (card) {
            lowConfidenceFiles.push({
              card,
              currentPlacement: output,
            });
          }
        }
      }

      if (lowConfidenceFiles.length > 0) {
        this.onProgress?.(
          `Optimizing ${lowConfidenceFiles.length} files with low confidence scores...`
        );

        const optimizedResults = await this.optimizer.optimizePlacements(
          plan,
          lowConfidenceFiles,
          this.onProgress
        );

        // Create a map of optimized results by fileId
        const optimizedMap = new Map<string, PlannerOutput>();
        for (const optResult of optimizedResults) {
          const card = cardMap.get(optResult.fileId);
          if (card) {
            optimizedMap.set(optResult.fileId, {
              file_id: optResult.fileId,
              virtual_path: optResult.virtualPath,
              tags: card.tags ?? [],
              confidence: optResult.confidence,
              reason: optResult.reason,
            });
          }
        }

        // Merge optimized results back into outputs
        for (let i = 0; i < outputs.length; i++) {
          const optimized = optimizedMap.get(outputs[i].file_id);
          if (optimized) {
            outputs[i] = optimized;
          }
        }

        const optimizedCount = optimizedMap.size;
        console.log(
          `[TaxonomyPlanner] Optimized ${optimizedCount} low-confidence file placements`
        );
      }
    }

    return outputs;
  }

  /**
   * Optimize existing virtual placements for low-confidence files only.
   * This method reads existing placements from the database and optimizes files with confidence < 0.7.
   */
  async optimizeExistingPlacements(sourceId: number): Promise<PlannerOutput[]> {
    if (!this.optimizer) {
      throw new Error('Optimizer not available - WorkerPool required');
    }

    // 1) Get existing virtual placements from database
    const dbPlacements = await this.db.getVirtualPlacements(sourceId);
    // Filter to only placements for files in this source
    const files = await this.db.getFilesBySource(sourceId, undefined, undefined, -1);
    const fileIds = new Set(files.map(f => f.file_id));
    const existingPlacements = dbPlacements.filter(p => fileIds.has(p.file_id));
    if (existingPlacements.length === 0) {
      this.onProgress?.('No existing virtual placements found. Run "Organize (AI Taxonomy)" first.');
      return [];
    }

    // 2) Get file cards for these placements
    const fileCards = await this.db.getFileCardsBySource(sourceId);
    const cardMap = new Map<string, FileCard>();
    for (const card of fileCards) {
      cardMap.set(card.file_id, card);
    }

    // 3) Find low-confidence files (< 70%)
    const lowConfidenceThreshold = 0.7;
    const lowConfidenceFiles: { card: FileCard; currentPlacement: PlannerOutput }[] = [];

    for (const placement of existingPlacements) {
      if (placement.confidence < lowConfidenceThreshold) {
        const card = cardMap.get(placement.file_id);
        if (card) {
          lowConfidenceFiles.push({
            card,
            currentPlacement: {
              file_id: placement.file_id,
              virtual_path: placement.virtual_path,
              tags: JSON.parse(placement.tags || '[]'),
              confidence: placement.confidence,
              reason: placement.reason,
            },
          });
        }
      }
    }

    if (lowConfidenceFiles.length === 0) {
      this.onProgress?.('No low-confidence files found to optimize.');
      return [];
    }

    // 4) Reconstruct the taxonomy plan from existing placements
    // We need to infer the taxonomy structure from existing folder paths
    const folderPaths = new Set<string>();
    for (const placement of existingPlacements) {
      const pathParts = placement.virtual_path.split('/').filter(Boolean);
      if (pathParts.length > 1) {
        // Get folder path (everything except the filename)
        const folderPath = '/' + pathParts.slice(0, -1).join('/');
        folderPaths.add(folderPath);
      }
    }

    // Build a simplified taxonomy plan from existing structure
    const folders = Array.from(folderPaths).map((path, index) => ({
      id: `folder-${index}`,
      path,
      description: `Folder from existing taxonomy`,
    }));

    // Create a catch-all rule for each folder
    const rules = folders.map((folder, index) => ({
      id: `rule-${index}`,
      targetFolderId: folder.id,
      priority: 50,
      reasonTemplate: `Placed in ${folder.path}`,
    }));

    const plan: TaxonomyPlan = { folders, rules };

    // 5) Run optimizer
    this.onProgress?.(`Found ${lowConfidenceFiles.length} low-confidence files to optimize...`);

    const optimizedResults = await this.optimizer.optimizePlacements(
      plan,
      lowConfidenceFiles,
      this.onProgress
    );

    // 6) Build updated PlannerOutput[] with optimized results
    const optimizedMap = new Map<string, PlannerOutput>();
    for (const optResult of optimizedResults) {
      const card = cardMap.get(optResult.fileId);
      if (card) {
        optimizedMap.set(optResult.fileId, {
          file_id: optResult.fileId,
          virtual_path: optResult.virtualPath,
          tags: card.tags ?? [],
          confidence: optResult.confidence,
          reason: optResult.reason,
        });
      }
    }

    // 7) Return all placements (optimized + unchanged) as PlannerOutput[]
    const finalPlacements: PlannerOutput[] = [];
    for (const placement of existingPlacements) {
      const optimized = optimizedMap.get(placement.file_id);
      if (optimized) {
        finalPlacements.push(optimized);
      } else {
        // Keep existing placement if not optimized
        finalPlacements.push({
          file_id: placement.file_id,
          virtual_path: placement.virtual_path,
          tags: JSON.parse(placement.tags || '[]'),
          confidence: placement.confidence,
          reason: placement.reason,
        });
      }
    }

    const optimizedCount = optimizedMap.size;
    console.log(`[TaxonomyPlanner] Optimized ${optimizedCount} low-confidence file placements`);

    return finalPlacements;
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

    // Pre-compute rule match counts for coverage analysis (used in confidence calculation)
    const ruleMatchCounts = this.computeRuleMatchCounts(plan.rules, fileCards);

    const outputs: PlannerOutput[] = [];

    for (const card of fileCards) {
      const matchResult = this.findBestRule(plan.rules, card);
      const match = matchResult?.rule;
      const matchQuality = matchResult?.matchQuality ?? 0;
      const folder = match ? folderById.get(match.targetFolderId) : undefined;

      // If no rule or folder matched, fall back to a simple catch-all under "/Other"
      const virtualFolderPath = folder?.path || '/Other';
      const rulePriority = match?.priority ?? minPriority;
      
      // Enhanced confidence calculation with multiple factors
      const baseConfidence = this.normalizeConfidence(rulePriority, minPriority, maxPriority);
      const confidence = match
        ? this.calculateEnhancedConfidence(
            match,
            baseConfidence,
            matchQuality,
            ruleMatchCounts.get(match.id) ?? 0,
            fileCards.length
          )
        : baseConfidence * 0.6; // Lower confidence for unmatched files

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

  /**
   * Find the best matching rule for a file card.
   * Returns both the rule and match quality score (0-1).
   */
  private findBestRule(
    rules: PlacementRule[],
    card: FileCard
  ): { rule: PlacementRule; matchQuality: number } | undefined {
    let best: PlacementRule | undefined;
    let bestScore = -Infinity;
    let bestMatchQuality = 0;

    for (const rule of rules) {
      const matchResult = this.ruleMatchesWithQuality(rule, card);
      if (!matchResult.matches) continue;

      // Calculate composite score: priority + specificity bonus
      const specificity = this.calculateRuleSpecificity(rule);
      const score = rule.priority + specificity * 10; // Specificity adds up to 10 points

      if (!best || score > bestScore) {
        best = rule;
        bestScore = score;
        bestMatchQuality = matchResult.matchQuality;
      }
    }

    return best ? { rule: best, matchQuality: bestMatchQuality } : undefined;
  }

  /**
   * Check if a rule matches a file card and return match quality (0-1).
   * Match quality indicates how many conditions matched vs. total conditions.
   */
  private ruleMatchesWithQuality(
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

    // requiredTags: all must be present
    if (rule.requiredTags && rule.requiredTags.length > 0) {
      conditionsChecked++;
      let allPresent = true;
      for (const raw of rule.requiredTags) {
        const t = raw.toLowerCase();
        if (!tagSet.has(t)) {
          allPresent = false;
          break;
        }
      }
      if (!allPresent) {
        return { matches: false, matchQuality: 0 };
      }
      conditionsMatched++;
    }

    // forbiddenTags: none may be present
    if (rule.forbiddenTags && rule.forbiddenTags.length > 0) {
      conditionsChecked++;
      let nonePresent = true;
      for (const raw of rule.forbiddenTags) {
        const t = raw.toLowerCase();
        if (tagSet.has(t)) {
          nonePresent = false;
          break;
        }
      }
      if (!nonePresent) {
        return { matches: false, matchQuality: 0 };
      }
      conditionsMatched++;
    }

    // pathContains: at least one substring must appear in path
    if (rule.pathContains && rule.pathContains.length > 0) {
      conditionsChecked++;
      const anyMatch = rule.pathContains.some((p) => {
        const needle = String(p).toLowerCase();
        return needle.length > 0 && path.includes(needle);
      });
      if (!anyMatch) {
        return { matches: false, matchQuality: 0 };
      }
      conditionsMatched++;
    }

    // extensionIn: extension must be in the list (case-insensitive)
    if (rule.extensionIn && rule.extensionIn.length > 0) {
      conditionsChecked++;
      const allowed = rule.extensionIn.map((e) => String(e).toLowerCase());
      if (!allowed.includes(ext)) {
        return { matches: false, matchQuality: 0 };
      }
      conditionsMatched++;
    }

    // summaryContainsAny: at least one keyword must appear in summary
    if (rule.summaryContainsAny && rule.summaryContainsAny.length > 0) {
      conditionsChecked++;
      const anyMatch = rule.summaryContainsAny.some((kw) => {
        const needle = String(kw).toLowerCase();
        return needle.length > 0 && summary.includes(needle);
      });
      if (!anyMatch) {
        return { matches: false, matchQuality: 0 };
      }
      conditionsMatched++;
    }

    // If no conditions were checked, rule matches everything (catch-all)
    if (conditionsChecked === 0) {
      return { matches: true, matchQuality: 0.5 }; // Lower quality for catch-all rules
    }

    // Match quality = proportion of conditions that matched
    const matchQuality = conditionsMatched / conditionsChecked;
    return { matches: true, matchQuality };
  }

  /**
   * Calculate rule specificity based on number of conditions.
   * More conditions = more specific = higher score (0-1).
   */
  private calculateRuleSpecificity(rule: PlacementRule): number {
    let conditionCount = 0;
    if (rule.requiredTags && rule.requiredTags.length > 0) conditionCount++;
    if (rule.forbiddenTags && rule.forbiddenTags.length > 0) conditionCount++;
    if (rule.pathContains && rule.pathContains.length > 0) conditionCount++;
    if (rule.extensionIn && rule.extensionIn.length > 0) conditionCount++;
    if (rule.summaryContainsAny && rule.summaryContainsAny.length > 0) conditionCount++;

    // Normalize to 0-1 range (0 conditions = 0, 5+ conditions = 1)
    return Math.min(1, conditionCount / 5);
  }

  /**
   * Compute how many files each rule matches (for coverage analysis).
   */
  private computeRuleMatchCounts(
    rules: PlacementRule[],
    fileCards: FileCard[]
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const rule of rules) {
      let matchCount = 0;
      for (const card of fileCards) {
        const result = this.ruleMatchesWithQuality(rule, card);
        if (result.matches) {
          matchCount++;
        }
      }
      counts.set(rule.id, matchCount);
    }
    return counts;
  }

  /**
   * Normalize priority to base confidence (0.4-0.95).
   */
  private normalizeConfidence(priority: number, minPriority: number, maxPriority: number): number {
    if (maxPriority <= minPriority) {
      return 0.7;
    }
    const normalized = (priority - minPriority) / (maxPriority - minPriority);
    const clamped = Math.max(0, Math.min(1, normalized));
    // Keep confidence in a comfortable range [0.4, 0.95]
    return 0.4 + clamped * 0.55;
  }

  /**
   * Calculate enhanced confidence using multiple factors:
   * - Base confidence from priority
   * - Rule specificity (more conditions = higher confidence)
   * - Match quality (all conditions matched = higher confidence)
   * - Coverage penalty (rules matching too many files = lower confidence)
   */
  private calculateEnhancedConfidence(
    rule: PlacementRule,
    baseConfidence: number,
    matchQuality: number,
    matchCount: number,
    totalFiles: number
  ): number {
    // Specificity multiplier: more specific rules get boost (0.9-1.1)
    const specificity = this.calculateRuleSpecificity(rule);
    const specificityMultiplier = 0.9 + specificity * 0.2;

    // Match quality multiplier: perfect matches get boost (0.95-1.05)
    const matchQualityMultiplier = 0.95 + matchQuality * 0.1;

    // Coverage penalty: rules matching >50% of files get penalized (0.85-1.0)
    const coverageRatio = totalFiles > 0 ? matchCount / totalFiles : 0;
    const coveragePenalty = coverageRatio > 0.5 ? 0.85 + (1 - coverageRatio) * 0.15 : 1.0;

    // Combine all factors
    const enhancedConfidence =
      baseConfidence * specificityMultiplier * matchQualityMultiplier * coveragePenalty;

    // Clamp to reasonable range [0.3, 0.98]
    return Math.max(0.3, Math.min(0.98, enhancedConfidence));
  }

  private joinVirtualPath(folderPath: string, fileName: string): string {
    const base = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
    const safeFileName = fileName.startsWith('/') ? fileName.slice(1) : fileName;
    return `${base}/${safeFileName}`;
  }

  /**
   * Validate plan quality and log warnings for issues.
   */
  private validatePlan(plan: TaxonomyPlan, fileCards: FileCard[]): void {
    const ruleMatchCounts = this.computeRuleMatchCounts(plan.rules, fileCards);
    const totalFiles = fileCards.length;
    const folderById = new Map<string, VirtualFolderSpec>();
    for (const folder of plan.folders) {
      folderById.set(folder.id, folder);
    }

    // Check for unmatched files
    let unmatchedCount = 0;
    for (const card of fileCards) {
      const matchResult = this.findBestRule(plan.rules, card);
      if (!matchResult) {
        unmatchedCount++;
      }
    }

    if (unmatchedCount > 0) {
      console.warn(
        `[TaxonomyPlanner] ${unmatchedCount} files (${((unmatchedCount / totalFiles) * 100).toFixed(1)}%) don't match any rule. Consider adding a catch-all rule.`
      );
    }

    // Check for overly broad rules (>50% of files)
    for (const rule of plan.rules) {
      const matchCount = ruleMatchCounts.get(rule.id) ?? 0;
      const coverageRatio = matchCount / totalFiles;
      if (coverageRatio > 0.5) {
        console.warn(
          `[TaxonomyPlanner] Rule "${rule.id}" matches ${matchCount} files (${(coverageRatio * 100).toFixed(1)}%) - may be too broad. Consider making it more specific.`
        );
      }
    }

    // Check for overly narrow rules (<2 files)
    for (const rule of plan.rules) {
      const matchCount = ruleMatchCounts.get(rule.id) ?? 0;
      if (matchCount < 2 && matchCount > 0) {
        console.warn(
          `[TaxonomyPlanner] Rule "${rule.id}" matches only ${matchCount} file(s) - may be too specific.`
        );
      }
    }

    // Check for missing folders
    for (const rule of plan.rules) {
      if (!folderById.has(rule.targetFolderId)) {
        console.error(
          `[TaxonomyPlanner] Rule "${rule.id}" references missing folder "${rule.targetFolderId}"`
        );
      }
    }

    // Log rule statistics
    const avgMatchesPerRule =
      Array.from(ruleMatchCounts.values()).reduce((a, b) => a + b, 0) / plan.rules.length;
    console.log(
      `[TaxonomyPlanner] Plan validation: ${plan.folders.length} folders, ${plan.rules.length} rules, avg ${avgMatchesPerRule.toFixed(1)} matches per rule`
    );
  }
}

