import type { TaxonomyOverview } from '../../planner/taxonomy-overview';

export const TAXONOMY_AGENT_SYSTEM_PROMPT = `
You are an expert information architect designing a VIRTUAL folder tree (a taxonomy) for a user's files.

You NEVER move, rename, or delete real files. You only design:
- A small, human understandable virtual folder hierarchy, and
- A set of SIMPLE, DETERMINISTIC mapping rules that assign each file to one virtual folder.

You DO NOT see raw file contents. You only see:
- Aggregate statistics by extension, year, tags, and path patterns
- A few example "file cards" (path, summary, tags) per important tag

Your job:
1. Propose a concise virtual folder taxonomy (2–3 levels deep, no more than ~40 total folders).
2. Output simple rules that use ONLY:
   - tags (requiredTags, forbiddenTags)
   - file path substrings (pathContains)
   - file extension (extensionIn)
   - summary keywords (summaryContainsAny)
3. Keep rules human debuggable: avoid overlapping rules when possible, give higher priority to more specific rules.

You MUST respond with STRICT JSON matching this TypeScript shape:

{
  "folders": [
    {
      "id": "work-invoices-2024",
      "path": "/Work/Invoices/2024",
      "description": "Human-readable explanation of what belongs here"
    }
  ],
  "rules": [
    {
      "id": "rule-invoices-2024",
      "targetFolderId": "work-invoices-2024",
      "requiredTags": ["invoice", "2024"],
      "forbiddenTags": ["draft"],
      "pathContains": ["invoices", "billing"],
      "extensionIn": ["pdf", "xlsx"],
      "summaryContainsAny": ["invoice", "billing", "payment"],
      "priority": 80,
      "reasonTemplate": "Tagged as invoice 2024 and/or stored in an invoices/billing path"
    }
  ]
}

Constraints:
- Top-level folders: aim for 5–20, each with a clear purpose.
- Depth: usually 2–3 levels; avoid very deep trees.
- Rules: aim for 20–80 rules; each should be reasonably broad (cover more than a single file) but not so broad that everything matches.
- Every file should ideally match at least one rule; create a generic "/Other" or "/Uncategorized" folder + catch-all rule with low priority.

Never include comments or trailing commas in JSON. Never wrap JSON in markdown fences. Output ONLY the JSON object.
`.trim();

export const TAXONOMY_AGENT_USER_PROMPT = (
  overview: TaxonomyOverview
): string => {
  const payload = {
    sourceId: overview.sourceId,
    fileCount: overview.fileCount,
    byExtension: overview.byExtension,
    byYear: overview.byYear,
    topTags: overview.topTags,
    topPathPatterns: overview.topPathPatterns,
    sampleFilesByTag: overview.samples.map((entry) => ({
      tag: entry.tag,
      files: entry.files.map((file) => ({
        // Keep this payload intentionally compact to avoid huge prompts.
        // Relative path is usually enough for context; we omit full path here.
        relative_path: file.relative_path,
        name: file.name,
        extension: file.extension,
        mtime: file.mtime,
        // Truncate summaries so we don't blow up token counts.
        summary:
          file.summary && file.summary.length > 600
            ? `${file.summary.slice(0, 600)}…`
            : file.summary,
        // Limit tags per file to keep things small but still representative.
        tags: Array.isArray(file.tags) ? file.tags.slice(0, 12) : file.tags,
      })),
    })),
  };

  const serialized = JSON.stringify(payload, null, 2);

  return [
    'You are designing a virtual folder taxonomy and mapping rules for a single source of files.',
    '',
    'Here is a JSON overview of this source:',
    serialized,
    '',
    'Using ONLY the information above, design a virtual folder taxonomy and a set of deterministic mapping rules.',
    '',
    'Requirements:',
    '- Use tags, path patterns, extensions, and summary keywords to define rules.',
    '- Keep the folder structure reasonably small and interpretable.',
    '- Prefer stable, semantic folder names that will still make sense as more files are added.',
    '- Use priorities so that more specific rules win over generic ones.',
    '',
    'Respond with a single JSON object matching the TaxonomyPlan type exactly (no extra fields, no comments, no markdown).',
  ].join('\n');
};

