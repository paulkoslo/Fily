import type { TaxonomyPlan } from '../../planner/taxonomy-types';
import type { FileCard } from '../../ipc/contracts';
import { OPTIMIZER_CONFIDENCE_THRESHOLD, OPTIMIZER_MAX_SUMMARY_WORDS } from '../../planner/constants';

/**
 * Input for optimizer batch processing
 */
export interface OptimizerBatchInput {
  fileCards: FileCard[];
  currentPlacements: {
    fileId: string;
    virtualPath: string;
    confidence: number;
    reason: string;
  }[];
}

/**
 * System prompt for the Optimizer Agent
 */
export const OPTIMIZER_AGENT_SYSTEM_PROMPT = `
You are an expert file organization optimizer. Your job is to re-evaluate files that received low confidence scores (<${Math.round(OPTIMIZER_CONFIDENCE_THRESHOLD * 100)}%) in the initial taxonomy placement and suggest better placements.

You are given:
1. The complete taxonomy plan (folders + rules) that was already created
2. A batch of files that received low confidence scores
3. Their current placements and confidence scores

Your task:
- Analyze each file's content (summary, tags, path, extension)
- Match it against the existing taxonomy folders and rules
- Suggest the BEST virtual folder path for each file
- Provide a confidence score (0.0-1.0) and clear reasoning

CRITICAL: The virtualPath MUST include the filename at the end. For example:
- ✅ CORRECT: "/Work/Invoices/2024/invoice.pdf" (includes filename)
- ❌ WRONG: "/Work/Invoices/2024" (missing filename)

You MUST respond with STRICT JSON matching this shape:

{
  "optimizations": [
    {
      "fileId": "abc123...",
      "virtualPath": "/Work/Invoices/2024/invoice.pdf",
      "confidence": 0.85,
      "reason": "File matches invoice tags and 2024 year tag, fits perfectly in Work/Invoices/2024"
    }
  ],
  "newFolders": [
    {
      "path": "/Projects/NewCategory",
      "description": "Files related to a specific project category that doesn't fit existing folders"
    }
  ]
}

Note: "newFolders" is optional - only include it if you're creating new folders. If all files fit in existing folders, omit "newFolders" or use an empty array.

Guidelines:
- PREFER using existing folders from the taxonomy plan when files fit well
- CREATE NEW FOLDERS when files don't fit well in existing structure (e.g., new project category, specialized content type)
- New folders should be semantically meaningful and follow the existing taxonomy structure (e.g., "/Projects/NewCategory", not "/RandomStuff")
- Confidence should be higher (0.7-0.98) if the file clearly matches a specific folder's purpose (existing or new)
- Confidence should be lower (0.3-0.6) if the file doesn't fit well anywhere
- Provide clear, specific reasons explaining why this placement is better
- If creating a new folder, provide a descriptive path and description
- Consider multiple factors: tags, path patterns, extension, summary content

Never include comments or trailing commas in JSON. Never wrap JSON in markdown fences. Output ONLY the JSON object.
`.trim();

/**
 * Build user prompt for optimizer agent
 */
export function buildOptimizerPrompt(
  plan: TaxonomyPlan,
  batch: OptimizerBatchInput
): string {
  const payload = {
    taxonomy: {
      folders: plan.folders.map((f) => ({
        id: f.id,
        path: f.path,
        description: f.description,
      })),
      rules: plan.rules.map((r) => ({
        id: r.id,
        targetFolderId: r.targetFolderId,
        requiredTags: r.requiredTags,
        forbiddenTags: r.forbiddenTags,
        pathContains: r.pathContains,
        extensionIn: r.extensionIn,
        summaryContainsAny: r.summaryContainsAny,
        priority: r.priority,
        reasonTemplate: r.reasonTemplate,
      })),
    },
    files: batch.fileCards.map((card, index) => {
      const currentPlacement = batch.currentPlacements[index];
      
      // Truncate summary to word limit for token management
      let truncatedSummary = card.summary;
      if (card.summary) {
        const words = card.summary.split(/\s+/).filter(w => w.length > 0);
        if (words.length > OPTIMIZER_MAX_SUMMARY_WORDS) {
          truncatedSummary = words.slice(0, OPTIMIZER_MAX_SUMMARY_WORDS).join(' ') + '…';
        }
      }
      
      return {
        fileId: card.file_id,
        name: card.name,
        extension: card.extension,
        relative_path: card.relative_path,
        tags: card.tags ?? [],
        summary: truncatedSummary,
        currentPlacement: currentPlacement
          ? {
              virtualPath: currentPlacement.virtualPath,
              confidence: currentPlacement.confidence,
              reason: currentPlacement.reason,
            }
          : null,
      };
    }),
  };

  const serialized = JSON.stringify(payload, null, 2);

  return [
    `You are optimizing placements for files that received low confidence scores (<${Math.round(OPTIMIZER_CONFIDENCE_THRESHOLD * 100)}%) in the initial taxonomy.`,
    '',
    'Here is the complete taxonomy plan and the files that need better placement:',
    serialized,
    '',
    `For each of the ${batch.fileCards.length} file(s) listed above, analyze its content and suggest the BEST virtual folder path from the existing taxonomy.`,
    '',
    'Requirements:',
    '- PREFER using existing folders from the taxonomy plan when files fit well',
    '- CREATE NEW FOLDERS when files don\'t fit well in existing structure (use "newFolders" array)',
    '- New folders should be semantically meaningful (e.g., "/Projects/NewCategory", "/Work/SpecializedType")',
    '- Match files to folders based on tags, path patterns, extension, and summary content',
    '- CRITICAL: virtualPath MUST include the filename at the end (e.g., "/Work/Invoices/file.pdf", NOT "/Work/Invoices")',
    '- Provide confidence scores (0.0-1.0) - higher for clear matches, lower for uncertain placements',
    '- Provide clear reasoning explaining why this placement is better than the current one',
    '- If creating a new folder, include it in the "newFolders" array with path and description',
    '- Return optimizations for ALL files in the batch in a single response',
    '',
    'Respond with a single JSON object matching the optimization response shape exactly (no extra fields, no comments, no markdown).',
  ].join('\n');
}
