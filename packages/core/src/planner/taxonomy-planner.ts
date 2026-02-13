import type { Planner } from './index';
import type { FileRecord, PlannerOutput, FileCard } from '../ipc/contracts';
import type { DatabaseManager } from '../db';
import { TaxonomyAgent, OptimizerAgent, ValidationAgent, type WorkerPool, type OptimizerNewFolder } from '../agents';
import { buildTaxonomyOverview } from './taxonomy-overview';
import { getTaxonomyStrategy } from './taxonomy-strategy';
import { runTaxonomyPlan } from './taxonomy-orchestrator';
import type { TaxonomyPlan, PlacementRule, VirtualFolderSpec } from './taxonomy-types';
import type { TaxonomyStrategy } from './taxonomy-strategy';
import {
  findBestRule,
  computeRuleMatchCounts,
  calculateRuleSpecificity,
} from './taxonomy-rule-matcher';
import {
  OPTIMIZER_CONFIDENCE_THRESHOLD,
  UNMATCHED_FILE_CONFIDENCE,
  STUB_PLANNER_CONFIDENCE,
  MIN_BASE_CONFIDENCE,
  BASE_CONFIDENCE_RANGE,
  MIN_SPECIFICITY_MULTIPLIER,
  SPECIFICITY_MULTIPLIER_RANGE,
  MIN_MATCH_QUALITY_MULTIPLIER,
  MATCH_QUALITY_MULTIPLIER_RANGE,
  COVERAGE_PENALTY_THRESHOLD,
  MIN_COVERAGE_PENALTY,
  COVERAGE_PENALTY_RANGE,
  MAX_COVERAGE_PENALTY,
  MIN_ENHANCED_CONFIDENCE,
  MAX_ENHANCED_CONFIDENCE,
  BROAD_RULE_WARNING_THRESHOLD,
} from './constants';

export class TaxonomyPlanner implements Planner {
  readonly id = 'taxonomy-planner';
  readonly version = '0.1.0';

  private db: DatabaseManager;
  private agent: TaxonomyAgent;
  private validator: ValidationAgent | null;
  private optimizer: OptimizerAgent | null;
  private onProgress?: (message: string) => void;

  constructor(
    db: DatabaseManager,
    agent?: TaxonomyAgent,
    workerPool?: WorkerPool,
    onProgress?: (message: string) => void
  ) {
    this.db = db;
    this.agent = agent ?? new TaxonomyAgent(workerPool);
    this.validator = workerPool ? new ValidationAgent(workerPool) : null;
    this.optimizer = workerPool ? new OptimizerAgent(workerPool) : null;
    this.onProgress = onProgress;
  }

  async plan(files: FileRecord[], options?: { skipOptimization?: boolean }): Promise<PlannerOutput[]> {
    if (files.length === 0) return [];

    // For now we assume all files belong to the same source.
    const sourceId = files[0].source_id;

    // 1) Build file cards from DB (includes summary + tags when available)
    const fileCards = await this.db.getFileCardsBySource(sourceId);
    if (fileCards.length === 0) {
      return [];
    }

    // 2) Choose strategy by file count (single vs hierarchical)
    const strategy = getTaxonomyStrategy(fileCards.length);

    // 3) Get plan: single-pass or multi-pass via orchestrator
    const plan: TaxonomyPlan =
      strategy.mode === 'single'
        ? await this.getSinglePassPlan(sourceId, fileCards, strategy)
        : await runTaxonomyPlan(fileCards, this.agent, strategy, {
            sourceId,
            onProgress: this.onProgress,
          });

    // 4) Repair rule→folder references (fixes LLM typos / case mismatches so files don't fall back to /Other)
    this.repairPlan(plan);

    // 5) Validate plan with ValidationAgent and apply corrections
    let validatedPlan = plan;
    let filesNeedingOptimization: string[] = [];
    if (this.validator) {
      const overview = buildTaxonomyOverview(sourceId, fileCards, {
        maxTags: strategy.maxTags,
        samplesPerTag: strategy.samplesPerTag,
      });
      const validationResult = await this.validator.validatePlan(plan, overview, fileCards, this.onProgress);
      
      if (validationResult.issues.length > 0) {
        this.onProgress?.(
          `Found ${validationResult.issues.length} issue(s) in taxonomy plan, applying corrections...`
        );
        validatedPlan = this.validator.applyCorrections(plan, validationResult);
        filesNeedingOptimization = validationResult.filesNeedingOptimization.map((f) => f.fileId);
        
        // Re-repair after corrections (new folders/rules might have issues)
        this.repairPlan(validatedPlan);
      }
    }

    // 6) Validate plan quality and log warnings
    this.validatePlan(validatedPlan, fileCards);

    // 7) Apply the plan deterministically to produce PlannerOutput[]
    const outputs = this.applyPlanToFiles(validatedPlan, fileCards);

    // 8) Optimize low-confidence files and files flagged by validator (unless skipped)
    if (this.optimizer && !options?.skipOptimization) {
      const lowConfidenceThreshold = OPTIMIZER_CONFIDENCE_THRESHOLD;
      const filesToOptimize = new Set(filesNeedingOptimization);
      const lowConfidenceFiles: { card: FileCard; currentPlacement: PlannerOutput }[] = [];

      // Create a map of file_id to FileCard for quick lookup
      const cardMap = new Map<string, FileCard>();
      for (const card of fileCards) {
        cardMap.set(card.file_id, card);
      }

      // Find files with low confidence OR flagged by validator
      for (const output of outputs) {
        if (output.confidence < lowConfidenceThreshold || filesToOptimize.has(output.file_id)) {
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

        const { optimizations: optimizedResults, newFolders } = await this.optimizer.optimizePlacements(
          validatedPlan,
          lowConfidenceFiles,
          this.onProgress
        );

        // Add new folders from optimizer to the plan
        if (newFolders && newFolders.length > 0) {
          const existingFolderPaths = new Set(validatedPlan.folders.map(f => f.path));
          const newFolderSpecs = newFolders
            .filter(f => !existingFolderPaths.has(f.path))
            .map((f, index) => ({
              id: `optimizer-folder-${Date.now()}-${index}`,
              path: f.path.startsWith('/') ? f.path : '/' + f.path,
              description: f.description,
            }));
          
          if (newFolderSpecs.length > 0) {
            validatedPlan.folders.push(...newFolderSpecs);
            this.onProgress?.(`Optimizer created ${newFolderSpecs.length} new folder(s) for better organization`);
            console.log(`[TaxonomyPlanner] Optimizer created ${newFolderSpecs.length} new folder(s):`, newFolderSpecs.map(f => f.path));
          }
        }

        // Create a map of optimized results by fileId
        const optimizedMap = new Map<string, PlannerOutput>();
        for (const optResult of optimizedResults) {
          const card = cardMap.get(optResult.fileId);
          if (card) {
            // Ensure virtualPath includes the filename (fix LLM mistakes)
            let virtualPath = optResult.virtualPath;
            if (!virtualPath.endsWith(card.name)) {
              // If path doesn't end with filename, append it
              const base = virtualPath.endsWith('/') ? virtualPath.slice(0, -1) : virtualPath;
              virtualPath = `${base}/${card.name}`;
              console.warn(
                `[TaxonomyPlanner] Optimizer returned path without filename for ${card.name}, repaired: ${virtualPath}`
              );
            }
            
            optimizedMap.set(optResult.fileId, {
              file_id: optResult.fileId,
              virtual_path: virtualPath,
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

  /** Single-pass: one overview, one full plan from the agent. */
  private async getSinglePassPlan(
    sourceId: number,
    fileCards: FileCard[],
    strategy: TaxonomyStrategy
  ): Promise<TaxonomyPlan> {
    const overview = buildTaxonomyOverview(sourceId, fileCards, {
      maxTags: strategy.maxTags,
      samplesPerTag: strategy.samplesPerTag,
    });
    return this.agent.generatePlan(overview);
  }

  /**
   * Optimize existing virtual placements for low-confidence files only.
   * This method reads existing placements from the database and optimizes files with confidence < OPTIMIZER_CONFIDENCE_THRESHOLD.
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

    // 3) Find low-confidence files (< OPTIMIZER_CONFIDENCE_THRESHOLD)
    const lowConfidenceThreshold = OPTIMIZER_CONFIDENCE_THRESHOLD;
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

    const { optimizations: optimizedResults, newFolders } = await this.optimizer.optimizePlacements(
      plan,
      lowConfidenceFiles,
      this.onProgress
    );

    // Add new folders from optimizer to the plan
    if (newFolders && newFolders.length > 0) {
      const existingFolderPaths = new Set(plan.folders.map(f => f.path));
      const newFolderSpecs = newFolders
        .filter(f => !existingFolderPaths.has(f.path))
        .map((f, index) => ({
          id: `optimizer-folder-${Date.now()}-${index}`,
          path: f.path.startsWith('/') ? f.path : '/' + f.path,
          description: f.description,
        }));
      
      if (newFolderSpecs.length > 0) {
        plan.folders.push(...newFolderSpecs);
        this.onProgress?.(`Optimizer created ${newFolderSpecs.length} new folder(s) for better organization`);
        console.log(`[TaxonomyPlanner] Optimizer created ${newFolderSpecs.length} new folder(s):`, newFolderSpecs.map(f => f.path));
      }
    }

    // 6) Build updated PlannerOutput[] with optimized results
    const optimizedMap = new Map<string, PlannerOutput>();
    for (const optResult of optimizedResults) {
      const card = cardMap.get(optResult.fileId);
      if (card) {
        // Ensure virtualPath includes the filename (fix LLM mistakes)
        let virtualPath = optResult.virtualPath;
        if (!virtualPath.endsWith(card.name)) {
          const base = virtualPath.endsWith('/') ? virtualPath.slice(0, -1) : virtualPath;
          virtualPath = `${base}/${card.name}`;
          console.warn(
            `[TaxonomyPlanner] Optimizer returned path without filename for ${card.name}, repaired: ${virtualPath}`
          );
        }
        
        optimizedMap.set(optResult.fileId, {
          file_id: optResult.fileId,
          virtual_path: virtualPath,
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
    const ruleMatchCounts = computeRuleMatchCounts(plan.rules, fileCards);

    const outputs: PlannerOutput[] = [];

    for (const card of fileCards) {
      const matchResult = findBestRule(plan.rules, card);
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
        : baseConfidence * UNMATCHED_FILE_CONFIDENCE; // Lower confidence for unmatched files

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
   * Repair plan so every rule's targetFolderId points to an existing folder.
   * Fixes LLM typos and case mismatches (e.g. "All" vs "all") so files are placed in the correct folder instead of falling back to /Other.
   */
  private repairPlan(plan: TaxonomyPlan): void {
    const normalizePath = (path: string) => {
      const p = path.trim().replace(/\\/g, '/');
      if (!p) return '/Other';
      const withLeading = p.startsWith('/') ? p : '/' + p;
      return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
    };

    for (const folder of plan.folders) {
      folder.path = normalizePath(folder.path);
    }

    const folderById = new Map<string, VirtualFolderSpec>();
    const idByLower = new Map<string, string>();
    for (const folder of plan.folders) {
      folderById.set(folder.id, folder);
      idByLower.set(folder.id.toLowerCase(), folder.id);
    }

    let fallbackId: string | undefined;
    for (const folder of plan.folders) {
      if (folder.path === '/Other' || folder.path.endsWith('/Other')) {
        fallbackId = folder.id;
        break;
      }
    }
    if (!fallbackId && plan.folders.length > 0) {
      fallbackId = plan.folders[0].id;
    }
    if (!fallbackId) {
      plan.folders.push({
        id: 'other',
        path: '/Other',
        description: 'Uncategorized',
      });
      folderById.set('other', plan.folders[plan.folders.length - 1]);
      idByLower.set('other', 'other');
      fallbackId = 'other';
    }

    let repaired = 0;
    for (const rule of plan.rules) {
      if (folderById.has(rule.targetFolderId)) continue;
      const byLower = idByLower.get(rule.targetFolderId.toLowerCase());
      if (byLower) {
        rule.targetFolderId = byLower;
        repaired++;
      } else {
        rule.targetFolderId = fallbackId!;
        repaired++;
      }
    }
    if (repaired > 0) {
      console.warn(
        `[TaxonomyPlanner] Repaired ${repaired} rule(s) with missing or mismatched targetFolderId (e.g. JSON/LLM typo or case mismatch).`
      );
    }
  }

  /**
   * Normalize priority to base confidence (MIN_BASE_CONFIDENCE-MAX_BASE_CONFIDENCE).
   */
  private normalizeConfidence(priority: number, minPriority: number, maxPriority: number): number {
    if (maxPriority <= minPriority) {
      return STUB_PLANNER_CONFIDENCE;
    }
    const normalized = (priority - minPriority) / (maxPriority - minPriority);
    const clamped = Math.max(0, Math.min(1, normalized));
    return MIN_BASE_CONFIDENCE + clamped * BASE_CONFIDENCE_RANGE;
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
    // Specificity multiplier: more specific rules get boost
    const specificity = calculateRuleSpecificity(rule);
    const specificityMultiplier = MIN_SPECIFICITY_MULTIPLIER + specificity * SPECIFICITY_MULTIPLIER_RANGE;

    // Match quality multiplier: perfect matches get boost
    const matchQualityMultiplier = MIN_MATCH_QUALITY_MULTIPLIER + matchQuality * MATCH_QUALITY_MULTIPLIER_RANGE;

    // Coverage penalty: rules matching >COVERAGE_PENALTY_THRESHOLD of files get penalized
    const coverageRatio = totalFiles > 0 ? matchCount / totalFiles : 0;
    const coveragePenalty = coverageRatio > COVERAGE_PENALTY_THRESHOLD
      ? MIN_COVERAGE_PENALTY + (1 - coverageRatio) * COVERAGE_PENALTY_RANGE
      : MAX_COVERAGE_PENALTY;

    // Combine all factors
    const enhancedConfidence =
      baseConfidence * specificityMultiplier * matchQualityMultiplier * coveragePenalty;

    // Clamp to reasonable range
    return Math.max(MIN_ENHANCED_CONFIDENCE, Math.min(MAX_ENHANCED_CONFIDENCE, enhancedConfidence));
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
    const ruleMatchCounts = computeRuleMatchCounts(plan.rules, fileCards);
    const totalFiles = fileCards.length;
    const folderById = new Map<string, VirtualFolderSpec>();
    for (const folder of plan.folders) {
      folderById.set(folder.id, folder);
    }

    // Check for unmatched files
    let unmatchedCount = 0;
    for (const card of fileCards) {
      const matchResult = findBestRule(plan.rules, card);
      if (!matchResult) {
        unmatchedCount++;
      }
    }

    if (unmatchedCount > 0) {
      console.warn(
        `[TaxonomyPlanner] ${unmatchedCount} files (${((unmatchedCount / totalFiles) * 100).toFixed(1)}%) don't match any rule. Consider adding a catch-all rule.`
      );
    }

    // Check for overly broad rules (>BROAD_RULE_WARNING_THRESHOLD of files)
    for (const rule of plan.rules) {
      const matchCount = ruleMatchCounts.get(rule.id) ?? 0;
      const coverageRatio = matchCount / totalFiles;
      if (coverageRatio > BROAD_RULE_WARNING_THRESHOLD) {
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

