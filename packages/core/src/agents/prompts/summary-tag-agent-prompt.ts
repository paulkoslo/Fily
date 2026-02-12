/**
 * Summary+Tag Agent Prompt
 * 
 * This agent generates BOTH a summary AND tags in a single API call.
 * Designed for efficient batch processing while maintaining quality.
 */

export const SUMMARY_TAG_AGENT_SYSTEM_PROMPT = `You are an intelligent file management assistant that generates BOTH summaries AND tags for files in a single analysis pass.

Your job is to analyze file content, metadata, and location to generate:
1. A concise summary (max 200 characters) optimized for file organization
2. 15-20 tags for file discovery and categorization

CRITICAL REQUIREMENTS:

SUMMARY GENERATION:
- Max 1000 characters - concise, distinctive description
- Focus on: document type, subject matter, key entities (people/organizations), time periods, purpose
- Avoid generic terms like "document", "file", "content" - be specific
- Include dates/years when they define the document (e.g., "2015-2025", "March 2024")
- Make it searchable and distinctive

TAG GENERATION (MANDATORY PROCESS - FOLLOW IN ORDER):

STEP 1: PATH ANALYSIS (MANDATORY - MINIMUM 5-8 TAGS FROM PATH!)
- Extract ALL meaningful folder names from the file path
- Convert to lowercase tags (e.g., "Documents/Academic" → ["documents", "academic"])
- Extract project names, domain names, organizational structure
- Extract years, quarters, months, versions from folder names
- Skip only generic roots like "Users", "home" at the very beginning
- MINIMUM 5-8 tags MUST come from the file path

STEP 2: FILE NAME & DATE ANALYSIS
- Extract meaningful words from file name
- Extract years, months, date ranges (e.g., "2015-2025", "2024-03")
- Convert dates to tags (e.g., "2024", "march-2024", "2015-2025")

STEP 3: SUMMARY ANALYSIS
- Extract document type (dissertation, invoice, report, script, etc.)
- Extract subject matter (research topics, business domains, code purpose)
- Extract people names (authors, speakers, participants)
- Extract organizations (universities, companies, institutions)
- Extract time periods mentioned in summary

STEP 4: METADATA TAGS (if relevant)
- File format only if meaningful (e.g., "spreadsheet" for xlsx)
- Author names from metadata
- Sheet names for spreadsheets
- Any explicit dates in metadata

TAG QUALITY REQUIREMENTS:
- AT LEAST 15 tags total (ideally 15-25)
- MINIMUM 5 tags from file path
- Be specific: "eu-parliament" not "politics", "q4-2024" not "quarter"
- Hierarchical: include both broad ("academic") and specific ("political-science")
- All lowercase with hyphens: "q4-2024", "paul-koslowsky"
- No duplicates
- Avoid generic terms: never use "file", "document", "content" alone

OUTPUT FORMAT:

For single files, respond with JSON:
{
  "summary": "Concise summary here (max 200 chars)",
  "tags": ["tag1", "tag2", "tag3", ...] // 15-20 tags minimum
}

For batches, respond with JSON array:
[
  {
    "fileId": "file_id_1",
    "summary": "Summary for file 1",
    "tags": ["tag1", "tag2", ...]
  },
  {
    "fileId": "file_id_2",
    "summary": "Summary for file 2",
    "tags": ["tag1", "tag2", ...]
  }
]

EXAMPLES:

File: "/Users/paul/Documents/Academic/Thesis_Paul_Koslowsky.pdf"
Summary: "Dissertation: Rhetorical polarization analysis in EU Parliament (2015-2025) using multilingual speech - Paul Koslowsky"
Tags: ["documents", "academic", "thesis", "dissertation", "paul-koslowsky", "eu-parliament", "rhetorical-analysis", "multilingual-speech", "political-science", "2015-2025", "2025", "speech-analysis", "polarization", "research", "academic-writing"]

File: "/Users/john/Projects/WebApp/src/utils.ts"
Summary: "TypeScript utility functions for data processing and validation"
Tags: ["projects", "webapp", "src", "code", "typescript", "utilities", "data-processing", "validation", "functions", "javascript", "programming", "software-development"]

Remember: Generate BOTH summary AND tags. Path analysis is MANDATORY and must yield at least 5-8 tags.`;

/**
 * Build user prompt for a single text/code file
 */
export function buildTextFilePrompt(
  fileId: string,
  filePath: string,
  fileName: string,
  extension: string,
  contentType: 'text' | 'pdf' | 'document' | 'audio' | 'video',
  content: string,
  isEmpty: boolean,
  metadata?: Record<string, any>
): string {
  const isCodeFile = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'kt'].includes(extension.toLowerCase());
  const fileType = isCodeFile ? 'code file' : contentType === 'pdf' ? 'PDF document' : contentType === 'audio' ? 'audio file' : contentType === 'video' ? 'video file' : 'text file';
  
  const metadataStr = metadata ? `\n\nMetadata:\n${JSON.stringify(metadata, null, 2)}` : '';
  
  const pathParts = filePath.split(/[\\/]/).filter(p => p.length > 0);
  const pathContext = pathParts.length > 0 
    ? `\n\nPath breakdown:\n${pathParts.map((p, i) => `  [${i}] ${p}`).join('\n')}`
    : '';

  return `Analyze this ${fileType} and generate BOTH a summary AND tags.

═══════════════════════════════════════════════════════════════
FILE INFORMATION:
═══════════════════════════════════════════════════════════════
File ID: ${fileId}
File Path: ${filePath}${pathContext}
File Name: ${fileName}
Extension: .${extension}
${isEmpty ? 'Status: Empty file' : ''}${metadataStr}

═══════════════════════════════════════════════════════════════
CONTENT:
═══════════════════════════════════════════════════════════════
${isEmpty ? '[Empty file]' : content}

═══════════════════════════════════════════════════════════════
REQUIREMENTS:
═══════════════════════════════════════════════════════════════
1. Generate a concise summary (max 200 characters)
2. Generate 15-20 tags following the mandatory process:
   - STEP 1: Extract 5-8 tags from file path (MANDATORY!)
   - STEP 2: Extract tags from file name and dates
   - STEP 3: Extract tags from summary content
   - STEP 4: Add metadata tags if relevant

Respond with JSON: { "summary": "...", "tags": [...] }`;
}

/**
 * Build user prompt for a scanned/image-based PDF
 */
export function buildScannedPDFPrompt(
  fileId: string,
  filePath: string,
  fileName: string,
  metadata?: Record<string, any>
): string {
  const metaLines: string[] = [];
  if (fileName) metaLines.push(`File name: ${fileName}`);
  if (filePath) metaLines.push(`File path: ${filePath}`);
  if (metadata?.title) metaLines.push(`PDF title: ${metadata.title}`);
  if (metadata?.author) metaLines.push(`Author: ${metadata.author}`);
  if (metadata?.subject) metaLines.push(`Subject: ${metadata.subject}`);
  if (metadata?.pages != null) metaLines.push(`Pages: ${metadata.pages}`);
  if (metadata?.creator) metaLines.push(`Creator: ${metadata.creator}`);
  if (metadata?.producer) metaLines.push(`Producer: ${metadata.producer}`);
  if (metadata?.creationDate) metaLines.push(`Creation date: ${metadata.creationDate}`);
  if (metadata?.modDate) metaLines.push(`Modified date: ${metadata.modDate}`);

  const pathParts = filePath.split(/[\\/]/).filter(p => p.length > 0);
  const pathContext = pathParts.length > 0 
    ? `\n\nPath breakdown:\n${pathParts.map((p, i) => `  [${i}] ${p}`).join('\n')}`
    : '';

  return `This is a SCANNED PDF (image-based) - there is no readable text content, only metadata.

Analyze the metadata and file path to generate BOTH a summary AND tags.

═══════════════════════════════════════════════════════════════
FILE INFORMATION:
═══════════════════════════════════════════════════════════════
File ID: ${fileId}
File Path: ${filePath}${pathContext}
File Name: ${fileName}

═══════════════════════════════════════════════════════════════
METADATA:
═══════════════════════════════════════════════════════════════
${metaLines.length > 0 ? metaLines.join('\n') : '[No metadata available]'}

═══════════════════════════════════════════════════════════════
REQUIREMENTS:
═══════════════════════════════════════════════════════════════
1. Generate a best-guess summary (max 200 chars) - mention it's a scanned PDF
2. Generate 15-20 tags following the mandatory process:
   - STEP 1: Extract 5-8 tags from file path (MANDATORY!)
   - STEP 2: Extract tags from file name and dates
   - STEP 3: Extract tags from metadata
   - STEP 4: Infer document type from metadata

Respond with JSON: { "summary": "...", "tags": [...] }`;
}

/**
 * Build user prompt for an image file
 */
export function buildImagePrompt(
  fileId: string,
  filePath: string,
  fileName: string,
  extension: string,
  metadata?: Record<string, any>
): string {
  const pathParts = filePath.split(/[\\/]/).filter(p => p.length > 0);
  const pathContext = pathParts.length > 0 
    ? `\n\nPath breakdown:\n${pathParts.map((p, i) => `  [${i}] ${p}`).join('\n')}`
    : '';

  const metadataStr = metadata ? `\n\nMetadata:\n${JSON.stringify(metadata, null, 2)}` : '';

  return `Analyze this image and generate BOTH a summary AND tags.

Focus on: image type (screenshot/photo/scan/diagram), visible text content, context (app/program/document), people/dates if visible, and what makes this image unique and searchable.

═══════════════════════════════════════════════════════════════
FILE INFORMATION:
═══════════════════════════════════════════════════════════════
File ID: ${fileId}
File Path: ${filePath}${pathContext}
File Name: ${fileName}
Extension: .${extension}${metadataStr}

═══════════════════════════════════════════════════════════════
REQUIREMENTS:
═══════════════════════════════════════════════════════════════
1. Generate a distinctive summary (max 200 chars) describing the image
2. Generate 15-20 tags following the mandatory process:
   - STEP 1: Extract 5-8 tags from file path (MANDATORY!)
   - STEP 2: Extract tags from file name and dates
   - STEP 3: Extract tags from image content (what you see)
   - STEP 4: Add metadata tags if relevant

Respond with JSON: { "summary": "...", "tags": [...] }`;
}

/**
 * Build batch prompt for multiple files
 */
export function buildBatchPrompt(files: Array<{
  fileId: string;
  filePath: string;
  fileName: string;
  extension: string;
  contentType: 'text' | 'pdf' | 'document' | 'image' | 'audio' | 'video';
  contentPreview: string;
  isEmpty: boolean;
  metadata?: Record<string, any>;
}>): string {
  const fileDescriptions = files.map((file, i) => {
    const pathParts = file.filePath.split(/[\\/]/).filter(p => p.length > 0);
    const pathContext = pathParts.length > 0 
      ? `\n  Path: ${pathParts.join(' → ')}`
      : '';
    
    const metadataStr = file.metadata ? `\n  Metadata: ${JSON.stringify(file.metadata)}` : '';

    return `
═══════════════════════════════════════════════════════════════
FILE ${i + 1}/${files.length}: ${file.fileName}
═══════════════════════════════════════════════════════════════
File ID: ${file.fileId}
File Path: ${file.filePath}${pathContext}
Extension: .${file.extension}
Content Type: ${file.contentType}
${file.isEmpty ? 'Status: Empty file' : ''}${metadataStr}

Content Preview:
${file.contentPreview}
═══════════════════════════════════════════════════════════════`;
  });

  return `Process ${files.length} files and generate BOTH summary AND tags for each.

For each file, generate:
1. A concise summary (max 200 characters)
2. 15-20 tags following the mandatory process:
   - STEP 1: Extract 5-8 tags from file path (MANDATORY for each file!)
   - STEP 2: Extract tags from file name and dates
   - STEP 3: Extract tags from content/summary
   - STEP 4: Add metadata tags if relevant

${fileDescriptions.join('\n')}

Respond with a JSON array where each object has:
- "fileId": the file ID (required)
- "summary": the summary string
- "tags": array of tag strings (minimum 15 tags per file)

Example format:
[
  {
    "fileId": "${files[0]?.fileId || 'file_id_1'}",
    "summary": "Summary here",
    "tags": ["tag1", "tag2", ...]
  },
  ...
]`;
}
