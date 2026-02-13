/**
 * Configuration constants for all agents and planners.
 * All thresholds, limits, and parameters should be defined here for easy adjustment.
 * 
 * PRINCIPLE: Change ONE number here, and it updates everywhere automatically.
 */

// ============================================================================
// AGENT BATCH SIZES
// ============================================================================

/**
 * SummaryTagAgent batch sizes.
 */
export const SUMMARY_TAG_VISION_BATCH_SIZE = 5; // Images: small batches due to base64 size
export const SUMMARY_TAG_TEXT_BATCH_SIZE = 20; // Text files: optimal token usage
export const OPTIMIZER_BATCH_SIZE = 25; // Optimizer: files per batch

/**
 * SummaryTagAgent content limits.
 */
export const SUMMARY_TAG_MAX_WORDS_PER_FILE = 500; // Max words per file when batching
export const SUMMARY_TAG_MAX_SUMMARY_LENGTH = 200; // Max characters for summary
export const SUMMARY_TAG_MIN_TAGS = 15; // Minimum tags per file
export const SUMMARY_TAG_MAX_TAGS = 25; // Maximum tags per file
export const SUMMARY_TAG_MIN_TAGS_FROM_PATH = 5; // Minimum tags extracted from file path

/**
 * OptimizerAgent content limits.
 */
export const OPTIMIZER_MAX_SUMMARY_WORDS = 100; // Max words for summary in optimizer prompt

// ============================================================================
// API & TIMEOUT SETTINGS
// ============================================================================

/**
 * API call timeouts (milliseconds).
 */
export const API_DEFAULT_TIMEOUT_MS = 180000; // 3 minutes default timeout
export const API_BATCH_TIMEOUT_MS = 240000; // 4 minutes for batch processing

/**
 * API token limits.
 */
export const API_DEFAULT_MAX_TOKENS = 5000; // Default max completion tokens
export const API_VISION_MAX_TOKENS = 20000; // Max tokens for vision API calls

/**
 * WorkerPool settings.
 */
export const WORKER_POOL_DEFAULT_MAX_WORKERS = 80; // Default concurrent workers
export const WORKER_POOL_MAX_ITERATIONS = 10000; // Safety limit for queue waiting
export const WORKER_POOL_CHECK_INTERVAL_MS = 50; // How often to check queue

// ============================================================================
// FILE SIZE LIMITS
// ============================================================================

/**
 * Image processing limits.
 */
export const BASE64_IMAGE_MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB base64 limit

/**
 * Content truncation limits.
 */
export const TRANSCRIPTION_TRUNCATE_LENGTH = 2000; // Max chars for audio transcription in prompts

// ============================================================================
// VALIDATION & TAXONOMY LIMITS
// ============================================================================

/**
 * ValidationAgent limits.
 */
export const VALIDATION_TOP_TAGS_LIMIT = 20; // Top tags to include in validation prompt
export const VALIDATION_TOP_PATTERNS_LIMIT = 15; // Top path patterns to include
export const VALIDATION_SUMMARY_PREVIEW_LENGTH = 200; // Summary preview length

/**
 * TaxonomyAgent prompt limits.
 */
export const TAXONOMY_SUMMARY_PREVIEW_LENGTH = 500; // Summary preview in taxonomy prompts (top-level)
export const TAXONOMY_SUMMARY_PREVIEW_LENGTH_FULL = 600; // Summary preview in full taxonomy prompt
export const TAXONOMY_SUMMARY_PREVIEW_LENGTH_SUB = 400; // Summary preview in sub-level prompts
export const TAXONOMY_TAGS_PREVIEW_COUNT = 10; // Tags preview count in top-level prompts
export const TAXONOMY_TAGS_PREVIEW_COUNT_FULL = 12; // Tags preview count in full taxonomy prompt
export const TAXONOMY_TAGS_PREVIEW_COUNT_SUB = 8; // Tags preview count in sub-level prompts

// ============================================================================
// PLANNER CONFIDENCE SETTINGS
// ============================================================================

/**
 * Confidence threshold for optimizer.
 * Files with confidence below this value will be sent to OptimizerAgent for re-evaluation.
 */
export const OPTIMIZER_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Base confidence for unmatched files (fallback).
 * Used when no rule matches a file card.
 */
export const UNMATCHED_FILE_CONFIDENCE = 0.6;

/**
 * Default confidence for stub planner.
 */
export const STUB_PLANNER_CONFIDENCE = 0.7;

/**
 * Confidence calculation parameters.
 */

/** Minimum base confidence from priority normalization. */
export const MIN_BASE_CONFIDENCE = 0.4;

/** Maximum base confidence from priority normalization. */
export const MAX_BASE_CONFIDENCE = 0.95;

/** Range for base confidence calculation (MAX - MIN). */
export const BASE_CONFIDENCE_RANGE = MAX_BASE_CONFIDENCE - MIN_BASE_CONFIDENCE; // 0.55

/** Minimum specificity multiplier (for rules with no conditions). */
export const MIN_SPECIFICITY_MULTIPLIER = 0.9;

/** Maximum specificity multiplier (for rules with all conditions). */
export const MAX_SPECIFICITY_MULTIPLIER = 1.1;

/** Range for specificity multiplier (MAX - MIN). */
export const SPECIFICITY_MULTIPLIER_RANGE = MAX_SPECIFICITY_MULTIPLIER - MIN_SPECIFICITY_MULTIPLIER; // 0.2

/** Minimum match quality multiplier (for partial matches). */
export const MIN_MATCH_QUALITY_MULTIPLIER = 0.95;

/** Maximum match quality multiplier (for perfect matches). */
export const MAX_MATCH_QUALITY_MULTIPLIER = 1.05;

/** Range for match quality multiplier (MAX - MIN). */
export const MATCH_QUALITY_MULTIPLIER_RANGE = MAX_MATCH_QUALITY_MULTIPLIER - MIN_MATCH_QUALITY_MULTIPLIER; // 0.1

/** Coverage ratio threshold for penalty (rules matching >50% of files get penalized). */
export const COVERAGE_PENALTY_THRESHOLD = 0.5;

/** Minimum coverage penalty multiplier (for rules matching 100% of files). */
export const MIN_COVERAGE_PENALTY = 0.85;

/** Maximum coverage penalty multiplier (no penalty). */
export const MAX_COVERAGE_PENALTY = 1.0;

/** Range for coverage penalty (MAX - MIN). */
export const COVERAGE_PENALTY_RANGE = MAX_COVERAGE_PENALTY - MIN_COVERAGE_PENALTY; // 0.15

/** Minimum enhanced confidence (clamp lower bound). */
export const MIN_ENHANCED_CONFIDENCE = 0.3;

/** Maximum enhanced confidence (clamp upper bound). */
export const MAX_ENHANCED_CONFIDENCE = 0.98;

/** Coverage ratio threshold for warning (rules matching >50% of files are too broad). */
export const BROAD_RULE_WARNING_THRESHOLD = 0.5;
