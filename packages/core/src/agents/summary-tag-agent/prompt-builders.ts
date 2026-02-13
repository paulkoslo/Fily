/**
 * SummaryTagAgent - Prompt Builders
 * 
 * Constructs LLM prompts for batch processing of vision and text files.
 * Optimizes token usage by truncating content and cleaning metadata.
 * 
 * Workflow Context:
 * - buildVisionBatchPrompt: Creates multi-image prompt with base64 images (used by batch-processor)
 * - buildTextBatchPrompt: Creates batch prompt with truncated text content (used by batch-processor)
 * - Strips large metadata fields (buffers, extractedText) to prevent token overflow
 * - Limits content to SUMMARY_TAG_MAX_WORDS_PER_FILE words per file
 * 
 * These builders ensure efficient API usage while maintaining quality results.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { FileProcessingInput } from './types';
import { SUMMARY_TAG_AGENT_SYSTEM_PROMPT } from '../prompts/summary-tag-agent-prompt';
import { buildBatchPrompt } from '../prompts/summary-tag-agent-prompt';
import { truncateContent } from './helpers';
import { SUMMARY_TAG_MAX_SUMMARY_LENGTH, SUMMARY_TAG_MAX_WORDS_PER_FILE } from '../../planner/constants';

/**
 * Build batch prompt for vision files
 * IMPORTANT: Strips out extracted text from metadata to prevent token overflow
 * Uses ONE prompt structure with all images included, not separate prompts per file
 */
export function buildVisionBatchPrompt(files: FileProcessingInput[]): ChatCompletionMessageParam[] {
  const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  
  // Start with ONE instruction block for all images
  contentParts.push({
    type: 'text',
    text: `Process ${files.length} images and generate BOTH summary AND tags for each file.

For each image, analyze:
- Image type (screenshot/photo/scan/diagram)
- Visible text content
- Context (app/program/document)
- People/dates if visible
- What makes this image unique and searchable

Generate for each:
1. A concise summary (max 200 chars)
2. 15-20 tags following this process:
   - STEP 1: Extract 5-8 tags from file path (MANDATORY!)
   - STEP 2: Extract tags from file name and dates
   - STEP 3: Extract tags from image content (what you see)
   - STEP 4: Add metadata tags if relevant

Respond with a JSON array in this format:
[
  {
    "fileId": "file_id_1",
    "summary": "Summary here",
    "tags": ["tag1", "tag2", ...]
  },
  ...
]

Now processing ${files.length} images:`,
  });

  // Add all images with minimal file info (no repeated instructions!)
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.imageBuffer && file.imageMimeType) {
      const base64Image = file.imageBuffer.toString('base64');
      
      // Add image
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${file.imageMimeType};base64,${base64Image}`,
        },
      });
      
      // Add minimal file info (just what's needed, no full prompt template)
      const pathParts = file.filePath.split(/[\\/]/).filter(p => p.length > 0);
      const pathContext = pathParts.length > 0 
        ? `\nPath: ${pathParts.join(' → ')}`
        : '';
      
      // Strip extracted text from metadata - only keep image-specific metadata
      const imageMetadata = file.metadata ? { ...file.metadata } : {};
      delete imageMetadata.extractedText;
      delete imageMetadata.text;
      delete imageMetadata.content;
      delete imageMetadata.ocrText;
      delete imageMetadata.imageBuffer;
      
      const cleanMetadata: Record<string, any> = {};
      if (imageMetadata.width) cleanMetadata.width = imageMetadata.width;
      if (imageMetadata.height) cleanMetadata.height = imageMetadata.height;
      if (imageMetadata.mimeType) cleanMetadata.mimeType = imageMetadata.mimeType;
      if (imageMetadata.size) cleanMetadata.size = imageMetadata.size;
      
      // Keep other non-text metadata (small values only)
      Object.keys(imageMetadata).forEach(key => {
        if (!['extractedText', 'text', 'content', 'ocrText', 'imageBuffer'].includes(key)) {
          const value = imageMetadata[key];
          if (typeof value !== 'string' || value.length < 500) {
            cleanMetadata[key] = value;
          }
        }
      });
      
      const metadataStr = Object.keys(cleanMetadata).length > 0 
        ? `\nMetadata: ${JSON.stringify(cleanMetadata)}`
        : '';
      
      contentParts.push({
        type: 'text',
        text: `\n--- Image ${i + 1}/${files.length} ---
File ID: ${file.fileId}
File Name: ${file.fileName}
File Path: ${file.filePath}${pathContext}
Extension: .${file.extension}${metadataStr}
`,
      });
    }
  }

  // ONE closing instruction
  contentParts.push({
    type: 'text',
    text: `\n\nNow generate the JSON array with summary and tags for all ${files.length} images above.`,
  });

  return [
    {
      role: 'system',
      content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: contentParts,
    },
  ];
}

/**
 * Build batch prompt for text files with token limiting (500 words per file)
 */
export function buildTextBatchPrompt(files: FileProcessingInput[]): ChatCompletionMessageParam[] {
  const batchFiles = files.map(file => {
    const isEmpty = !file.extractedText || file.extractedText.length === 0;
    
    let contentPreview = '';
    if (file.contentType === 'pdf') {
      const text = file.extractedText || '';
      const isImageBased = file.metadata?.isImageBased && text.trim().length === 0;
      
      if (isImageBased) {
        contentPreview = '[Scanned PDF - no text content]';
      } else {
        contentPreview = truncateContent(text, SUMMARY_TAG_MAX_WORDS_PER_FILE);
      }
    } else if (file.contentType === 'audio' || file.contentType === 'video') {
      const transcription = file.extractedText || '';
      contentPreview = truncateContent(transcription, SUMMARY_TAG_MAX_WORDS_PER_FILE);
    } else {
      const content = file.extractedText || '';
      contentPreview = isEmpty ? '[Empty file]' : truncateContent(content, SUMMARY_TAG_MAX_WORDS_PER_FILE);
    }

    // Clean metadata - remove large fields that bloat tokens (pdfBuffer, imageBuffer can be MBs!)
    const cleanMetadata: Record<string, any> = {};
    if (file.metadata) {
      Object.keys(file.metadata).forEach(key => {
        const value = file.metadata![key];
        // Skip large fields that aren't needed for tagging
        if (['imageBuffer', 'pdfBuffer', 'extractedText', 'text', 'content', 'ocrText'].includes(key)) {
          return; // Skip these - they can be MBs of base64!
        }
        // Only include small metadata values
        if (typeof value === 'string' && value.length < SUMMARY_TAG_MAX_SUMMARY_LENGTH) {
          cleanMetadata[key] = value;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          cleanMetadata[key] = value;
        } else if (Array.isArray(value) && value.length < 10) {
          cleanMetadata[key] = value;
        }
        // Skip objects (they might contain buffers)
      });
    }

    return {
      fileId: file.fileId,
      filePath: file.filePath,
      fileName: file.fileName,
      extension: file.extension,
      contentType: file.contentType,
      contentPreview,
      isEmpty,
      metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
    };
  });

  const userPrompt = buildBatchPrompt(batchFiles);

  return [
    {
      role: 'system',
      content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];
}
