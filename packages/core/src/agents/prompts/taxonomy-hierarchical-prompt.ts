import type { TaxonomyOverview } from '../../planner/taxonomy-overview';
import type { TaxonomyStrategy } from '../../planner/taxonomy-strategy';
import {
  TAXONOMY_SUMMARY_PREVIEW_LENGTH,
  TAXONOMY_TAGS_PREVIEW_COUNT,
  TAXONOMY_SUMMARY_PREVIEW_LENGTH_SUB,
  TAXONOMY_TAGS_PREVIEW_COUNT_SUB,
} from '../../planner/constants';

/**
 * Top-level pass: design ROOT categories that form the big picture.
 * Structure is primary; rules are secondary (placement is refined later).
 */

export const TAXONOMY_TOP_LEVEL_SYSTEM_PROMPT = `
You are an expert information architect. Your main job is to design the BEST HIGH-LEVEL FOLDER STRUCTURE for a file collection — the big picture that makes sense to a human.

You NEVER move, rename, or delete real files. You design:
1. A small set of ROOT virtual folders (e.g. /Work, /Personal, /Uni, /Projects, /Archive). These are the top-level categories.
2. Simple mapping rules so every file can be assigned to one root. Rule quality matters less than structure — we will refine placement later.

You only see aggregate statistics and sample file cards (path, summary, tags), not raw file contents.

PRIORITY: Get the folder structure right. Choose root categories that:
- Reflect how the user actually thinks about their files (work vs personal, projects, education, etc.)
- Are stable and meaningful as more files are added
- Do not overlap heavily (clear boundaries)

Rules: Keep them simple. Use requiredTags, forbiddenTags, pathContains, extensionIn, summaryContainsAny. Include one catch-all folder (e.g. /Other) with a low-priority rule (1–10). More specific rules get higher priority (50–100). We will match and optimize placement afterward.

You MUST respond with STRICT JSON:

{
  "folders": [
    { "id": "root-work", "path": "/Work", "description": "Work-related files" }
  ],
  "rules": [
    {
      "id": "rule-work",
      "targetFolderId": "root-work",
      "pathContains": ["work", "job"],
      "requiredTags": ["work"],
      "priority": 70,
      "reasonTemplate": "Work-related"
    }
  ]
}

Constraints:
- Folder paths: exactly one segment after the leading slash (e.g. /Work, /Personal). No nested paths.
- Output ONLY the JSON object (no markdown, no comments).
`.trim();

export function TAXONOMY_TOP_LEVEL_USER_PROMPT(
  overview: TaxonomyOverview,
  strategy: TaxonomyStrategy
): string {
  const targetCount = strategy.topLevelFolderCount;
  const payload = {
    sourceId: overview.sourceId,
    fileCount: overview.fileCount,
    byExtension: overview.byExtension,
    byYear: overview.byYear,
    topTags: overview.topTags,
    topPathPatterns: overview.topPathPatterns,
    sampleFilesByTag: overview.samples.map((entry) => ({
      tag: entry.tag,
      files: entry.files.map((f) => ({
        relative_path: f.relative_path,
        name: f.name,
        extension: f.extension,
        mtime: f.mtime,
        summary: f.summary && f.summary.length > TAXONOMY_SUMMARY_PREVIEW_LENGTH ? `${f.summary.slice(0, TAXONOMY_SUMMARY_PREVIEW_LENGTH)}…` : f.summary,
        tags: Array.isArray(f.tags) ? f.tags.slice(0, TAXONOMY_TAGS_PREVIEW_COUNT) : f.tags,
      })),
    })),
  };
  const serialized = JSON.stringify(payload, null, 2);
  return [
    'Design the TOP-LEVEL folder structure for this file collection. Focus on the big picture: what are the natural root categories?',
    '',
    `Aim for about ${targetCount} root folders. Each path must be a single segment: "/FolderName" (e.g. /Work, /Personal, /Uni, /Projects, /Archive, /Other).`,
    '',
    'Here is the JSON overview:',
    serialized,
    '',
    'Requirements:',
    '- Choose root categories that match how this collection is actually used (e.g. by life area, project type, or source).',
    '- Include a catch-all folder (e.g. /Other) with a low-priority rule (1–10).',
    '- Rules can be simple; placement will be refined later. More specific rules: priority 50–100; generic: 20–40.',
    '',
    'Respond with a single JSON object: { "folders": [...], "rules": [...] }. No extra fields, no markdown.',
  ].join('\n');
}

/**
 * Sub-level pass: subdivide ONLY when the content naturally splits into distinct categories.
 * If content is homogeneous or small, return a single child (e.g. parentPath/All) — do not force artificial splits.
 */

export const TAXONOMY_SUB_LEVEL_SYSTEM_PROMPT = `
You are an expert information architect designing the NEXT LEVEL of a virtual folder tree under a given parent path.

CRITICAL: Your goal is a MEANINGFUL folder structure, not a fixed number of subfolders.

- ONLY create multiple child folders when the files under this parent NATURALLY split into distinct categories (e.g. by topic, project, year, or type). Look at the overview: do you see clear clusters (different tags, path patterns, extensions)?
- If the content is homogeneous, or there is no clear way to split it, return exactly ONE child folder: parentPath/All (or parentPath/Documents) with a single catch-all rule. Do NOT invent artificial categories.
- If you do see natural groupings, create 2–10 child folders (e.g. parentPath/ProjectA, parentPath/ProjectB, parentPath/Research). Each folder path must be parentPath/ChildName.

You only see aggregate statistics and sample file cards for the files that belong under this parent.

You design:
1. Virtual folders that are direct children of the parent path.
2. Simple rules that assign each file in this subset to one of those children. Rules are secondary; we refine placement later.

You MUST respond with STRICT JSON:

{
  "folders": [
    { "id": "work-invoices", "path": "/Work/Invoices", "description": "Invoices" }
  ],
  "rules": [
    {
      "id": "rule-invoices",
      "targetFolderId": "work-invoices",
      "requiredTags": ["invoice"],
      "extensionIn": ["pdf"],
      "priority": 80,
      "reasonTemplate": "Invoice PDF"
    }
  ]
}

When NOT to subdivide: If files are all similar (same project, same type, or no clear clusters), return:
{
  "folders": [
    { "id": "all", "path": "/Parent/All", "description": "All files in this category" }
  ],
  "rules": [
    { "id": "catch-all", "targetFolderId": "all", "priority": 1, "reasonTemplate": "All files here" }
  ]
}

Constraints:
- Every folder path = parent path + one segment: parentPath/ChildName.
- Output ONLY the JSON object (no markdown, no comments).
`.trim();

export function TAXONOMY_SUB_LEVEL_USER_PROMPT(
  overview: TaxonomyOverview,
  parentPath: string,
  parentFolderId: string
): string {
  const normalizedParent = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
  const payload = {
    sourceId: overview.sourceId,
    fileCount: overview.fileCount,
    parentPath: normalizedParent,
    parentFolderId,
    byExtension: overview.byExtension,
    byYear: overview.byYear,
    topTags: overview.topTags,
    topPathPatterns: overview.topPathPatterns,
    sampleFilesByTag: overview.samples.map((entry) => ({
      tag: entry.tag,
      files: entry.files.map((f) => ({
        relative_path: f.relative_path,
        name: f.name,
        extension: f.extension,
        mtime: f.mtime,
        summary: f.summary && f.summary.length > TAXONOMY_SUMMARY_PREVIEW_LENGTH_SUB ? `${f.summary.slice(0, TAXONOMY_SUMMARY_PREVIEW_LENGTH_SUB)}…` : f.summary,
        tags: Array.isArray(f.tags) ? f.tags.slice(0, TAXONOMY_TAGS_PREVIEW_COUNT_SUB) : f.tags,
      })),
    })),
  };
  const serialized = JSON.stringify(payload, null, 2);
  return [
    `Design the folder structure under "${normalizedParent}". There are ${overview.fileCount} files in this branch.`,
    '',
    'IMPORTANT: Only create multiple subfolders if the content naturally splits into distinct categories (e.g. different projects, topics, or types). Look at tags, path patterns, and extensions in the overview.',
    '',
    `- If you see clear groupings: create 2–10 child folders. Each path must be "${normalizedParent}/ChildName".`,
    `- If the content is one coherent bucket or does not split clearly: return exactly ONE folder with path "${normalizedParent}/All" and one catch-all rule. Do not force artificial splits.`,
    '',
    'Here is the JSON overview of the files in this branch:',
    serialized,
    '',
    'Requirements:',
    '- Folder paths = parent + one segment (e.g. ' + normalizedParent + '/Research, ' + normalizedParent + '/Drafts).',
    '- Rules assign files to one of the child folders. Keep rules simple; placement is refined later.',
    '- If you create multiple folders, include a catch-all (e.g. ' + normalizedParent + '/Other) with priority 1–10.',
    '',
    'Respond with a single JSON object: { "folders": [...], "rules": [...] }. No extra fields, no markdown.',
  ].join('\n');
}
