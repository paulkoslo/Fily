/**
 * SummaryTagAgent - Single File Processing
 * 
 * Processes individual files when batch processing fails or for single-file requests.
 * Handles vision files (images) and text files (PDF, DOCX, code, audio, video) separately.
 * 
 * Workflow Context:
 * - processSingleVision: Processes one image file with vision API (fallback from batch failures)
 * - processSingleText: Processes one text file with text API (fallback from batch failures)
 * - Used by: batch-processor (when batch fails), main agent (processSingle method)
 * - Validates images, truncates content, handles API errors gracefully
 * 
 * This module ensures individual file processing works when batches fail.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { FileProcessingInput, FileProcessingResult } from './types';
import type { LLMClient } from '../llm-client';
import type { WorkerPool } from '../worker-pool';
import { executeApiCall } from '../api-call-helper';
import {
  SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
  buildImagePrompt,
  buildScannedPDFPrompt,
  buildTextFilePrompt,
} from '../prompts/summary-tag-agent-prompt';
import { parseSingleResponse } from './parsers';
import { generateFallbackResult } from './fallback';
import { isValidImage } from './helpers';
import { BASE64_IMAGE_MAX_SIZE_BYTES, API_DEFAULT_TIMEOUT_MS, TRANSCRIPTION_TRUNCATE_LENGTH } from '../../planner/constants';

/**
 * Process a single vision file
 */
export async function processSingleVision(
  file: FileProcessingInput,
  llmClient: LLMClient | null,
  workerPool: WorkerPool | null
): Promise<FileProcessingResult> {
  if (!file.imageBuffer || !file.imageMimeType) {
    console.warn(`[SummaryTagAgent] Missing image buffer or mimeType for ${file.fileName}`);
    return generateFallbackResult(file);
  }

  // Validate image format before sending to API
  const mimeType = file.imageMimeType.toLowerCase();
  const isValidFormat = mimeType.includes('jpeg') || mimeType.includes('jpg') || 
                       mimeType.includes('png') || mimeType.includes('webp');
  
  if (!isValidFormat) {
    console.warn(`[SummaryTagAgent] ⚠️ Unsupported image format "${file.imageMimeType}" for ${file.fileName}, using fallback`);
    return generateFallbackResult(file);
  }

  const fallback = () => JSON.stringify(generateFallbackResult(file));
  const base64Image = file.imageBuffer.toString('base64');
  
  // Validate base64 image size (very large images might cause issues)
  if (base64Image.length > BASE64_IMAGE_MAX_SIZE_BYTES) {
    console.warn(`[SummaryTagAgent] ⚠️ Image too large (${Math.round(base64Image.length / 1024 / 1024)}MB) for ${file.fileName}, using fallback`);
    return generateFallbackResult(file);
  }
  
  const userPrompt = buildImagePrompt(
    file.fileId,
    file.filePath,
    file.fileName,
    file.extension,
    file.metadata
  );

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: userPrompt,
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${file.imageMimeType};base64,${base64Image}`,
          },
        },
      ],
    },
  ];

  try {
    const response = await executeApiCall<string>(
      messages,
      fallback,
      workerPool,
      llmClient,
      {
        reason: `Processing single vision file: ${file.fileName}`,
        timeoutMs: API_DEFAULT_TIMEOUT_MS,
      }
    );

    return parseSingleResponse(response, file);
  } catch (error: any) {
    // Check if it's an invalid image error
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isInvalidImage = errorMsg.includes('Invalid image') || 
                          (error?.status === 400 && errorMsg.toLowerCase().includes('image'));
    
    if (isInvalidImage) {
      console.warn(`[SummaryTagAgent] ⚠️ Invalid image format detected for ${file.fileName}: ${errorMsg}`);
      return generateFallbackResult(file);
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Process a single text file
 * Note: This method is only called for non-image files (images are handled by processSingleVision)
 */
export async function processSingleText(
  file: FileProcessingInput,
  llmClient: LLMClient | null,
  workerPool: WorkerPool | null
): Promise<FileProcessingResult> {
  const fallback = () => JSON.stringify(generateFallbackResult(file));
  const isEmpty = !file.extractedText || file.extractedText.length === 0;

  let userPrompt: string;
  
  if (file.contentType === 'pdf') {
    const text = file.extractedText || '';
    const isImageBased = file.metadata?.isImageBased && text.trim().length === 0;
    
    if (isImageBased) {
      // Scanned PDF - use metadata only
      userPrompt = buildScannedPDFPrompt(
        file.fileId,
        file.filePath,
        file.fileName,
        file.metadata
      );
    } else {
      // Normal PDF - truncate content for single file processing
      const contentToAnalyze = text.length > 8000
        ? text.substring(0, 8000) + '\n[... content truncated ...]'
        : text;
      
      userPrompt = buildTextFilePrompt(
        file.fileId,
        file.filePath,
        file.fileName,
        file.extension,
        'pdf',
        contentToAnalyze,
        isEmpty,
        file.metadata
      );
    }
  } else {
    // Text/code/document/audio/video files (image files are handled separately)
    let contentToAnalyze: string;
    const contentTypeForPrompt: 'text' | 'pdf' | 'document' | 'audio' | 'video' = 
      file.contentType === 'image' ? 'text' : file.contentType;
    
    if (file.contentType === 'audio' || file.contentType === 'video') {
      const transcription = file.extractedText || '';
      contentToAnalyze = transcription.length > TRANSCRIPTION_TRUNCATE_LENGTH
        ? transcription.substring(0, TRANSCRIPTION_TRUNCATE_LENGTH) + '\n[... transcription truncated ...]'
        : transcription;
    } else {
      const content = file.extractedText || '';
      contentToAnalyze = isEmpty
        ? '[Empty file]'
        : content.length > 8000
        ? content.substring(0, 8000) + '\n[... content truncated ...]'
        : content;
    }
    
    userPrompt = buildTextFilePrompt(
      file.fileId,
      file.filePath,
      file.fileName,
      file.extension,
      contentTypeForPrompt,
      contentToAnalyze,
      isEmpty,
      file.metadata
    );
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: SUMMARY_TAG_AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];

  const response = await executeApiCall<string>(
    messages,
    fallback,
    workerPool,
    llmClient,
    {
      reason: `Processing single text file: ${file.fileName}`,
      timeoutMs: API_DEFAULT_TIMEOUT_MS,
    }
  );

  return parseSingleResponse(response, file);
}
