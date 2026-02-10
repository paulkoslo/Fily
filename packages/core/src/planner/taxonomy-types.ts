export type VirtualFolderSpec = {
  /**
   * Stable identifier for the virtual folder, used by placement rules.
   * Example: "work-invoices-2024"
   */
  id: string;

  /**
   * Virtual folder path, always starting with "/" (e.g. "/Work/Invoices/2024").
   */
  path: string;

  /**
   * Human-readable description of what belongs in this folder.
   */
  description: string;
};

export type PlacementRule = {
  /**
   * Stable identifier for the rule.
   */
  id: string;

  /**
   * ID of the target virtual folder this rule routes matching files to.
   */
  targetFolderId: string;

  /**
   * Tags that MUST all be present on a file for this rule to match.
   */
  requiredTags?: string[];

  /**
   * Tags that MUST NOT be present on a file for this rule to match.
   */
  forbiddenTags?: string[];

  /**
   * Substrings that, if any appear in the file path (relative or absolute), allow this rule to match.
   */
  pathContains?: string[];

  /**
   * File extensions (lowercase, without leading ".") that this rule applies to.
   */
  extensionIn?: string[];

  /**
   * Simple keyword matches that, if any appear in the summary text, allow this rule to match.
   */
  summaryContainsAny?: string[];

  /**
   * Higher priority wins when multiple rules match the same file.
   */
  priority: number;

  /**
   * Human-readable explanation template used when this rule fires.
   * For now this is used as-is; future versions may support interpolation.
   */
  reasonTemplate: string;
};

export type TaxonomyPlan = {
  /**
   * Virtual folders that define the high-level taxonomy.
   */
  folders: VirtualFolderSpec[];

  /**
   * Deterministic mapping rules from file features → target folders.
   */
  rules: PlacementRule[];
};

