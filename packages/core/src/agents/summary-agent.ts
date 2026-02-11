import {
  SUMMARY_AGENT_SYSTEM_PROMPT,
  SUMMARY_AGENT_TEXT_PROMPT,
  SUMMARY_AGENT_PDF_PROMPT,
  SUMMARY_AGENT_AUDIO_PROMPT,
  SUMMARY_AGENT_SCANNED_PDF_PROMPT,
} from './prompts/summary-agent-prompt';
import type { WorkerPool } from './worker-pool';
import { executeApiCall } from './api-call-helper';
import { createLLMClient, getProviderDisplayName, type LLMClient } from './llm-client';

/**
 * Summary Agent
 * 
 * This is THE master agent that generates summaries for ALL file types.
 * Other agents (organization, tagging, etc.) will use the summary data.
 * 
 * Each API call counts as 1 worker in the worker pool.
 * 
 * Supports both OpenRouter and OpenAI through the unified LLMClient.
 */
export class SummaryAgent {
  private llmClient: LLMClient | null = null;
  private workerPool: WorkerPool | null = null;

  constructor(workerPool?: WorkerPool) {
    this.llmClient = createLLMClient();
    if (this.llmClient) {
      console.log(`[SummaryAgent] Using ${getProviderDisplayName(this.llmClient.getProvider())} with model: ${this.llmClient.getModel()}`);
    }
    this.workerPool = workerPool || null;
  }

  /**
   * Generate summary for text/code files
   */
  async summarizeText(extension: string, content: string): Promise<string> {
    const fallback = () => this.generateFallbackText(extension, content);
    const isCodeFile = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'kt'].includes(extension.toLowerCase());
    const fileType = isCodeFile ? 'code file' : 'text file';
    const isEmpty = content.length === 0;

    const contentToAnalyze = isEmpty
      ? '[Empty file]'
      : content.length > 8000
      ? content.substring(0, 8000) + '\n[... content truncated ...]'
      : content;

    const messages = [
      {
        role: 'system' as const,
        content: SUMMARY_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: SUMMARY_AGENT_TEXT_PROMPT(fileType, extension, contentToAnalyze, isEmpty),
      },
    ];

    const summary = await executeApiCall<string>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient
    );

    return summary || fallback();
  }

  /**
   * Generate summary for PDF documents
   */
  async summarizePDF(
    extractedText: string,
    metadata?: {
      title?: string;
      author?: string;
      subject?: string;
    }
  ): Promise<string> {
    if (extractedText.length === 0) {
      return this.generateFallbackPDF(extractedText, metadata);
    }

    const fallback = () => this.generateFallbackPDF(extractedText, metadata);
    const metadataInfo = [
      metadata?.title && `Title: ${metadata.title}`,
      metadata?.author && `Author: ${metadata.author}`,
      metadata?.subject && `Subject: ${metadata.subject}`,
    ]
      .filter(Boolean)
      .join(', ');

    const textToAnalyze = extractedText.length > 8000
      ? extractedText.substring(0, 8000) + '\n[... content truncated ...]'
      : extractedText;

    const messages = [
      {
        role: 'system' as const,
        content: SUMMARY_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: SUMMARY_AGENT_PDF_PROMPT(metadataInfo, textToAnalyze),
      },
    ];

    const summary = await executeApiCall<string>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient
    );

    return summary || fallback();
  }

  /**
   * Generate summary for scanned/image-based PDFs where no embedded text is available.
   * Uses only metadata, filename and (optionally) path to guess what the PDF likely is.
   */
  async summarizeScannedPDF(metadata: {
    title?: string | null;
    author?: string | null;
    subject?: string | null;
    pages?: number | null;
    creator?: string | null;
    producer?: string | null;
    creationDate?: string | null;
    modDate?: string | null;
    fileName?: string | null;
    filePath?: string | null;
  }): Promise<string> {
    const fallback = () =>
      this.generateFallbackPDF('', { title: metadata.title ?? undefined, pages: metadata.pages ?? undefined });

    const metaLines: string[] = [];
    if (metadata.fileName) metaLines.push(`File name: ${metadata.fileName}`);
    if (metadata.filePath) metaLines.push(`File path: ${metadata.filePath}`);
    if (metadata.title) metaLines.push(`PDF title: ${metadata.title}`);
    if (metadata.author) metaLines.push(`Author: ${metadata.author}`);
    if (metadata.subject) metaLines.push(`Subject: ${metadata.subject}`);
    if (metadata.pages != null) metaLines.push(`Pages: ${metadata.pages}`);
    if (metadata.creator) metaLines.push(`Creator: ${metadata.creator}`);
    if (metadata.producer) metaLines.push(`Producer: ${metadata.producer}`);
    if (metadata.creationDate) metaLines.push(`Creation date (raw): ${metadata.creationDate}`);
    if (metadata.modDate) metaLines.push(`Modified date (raw): ${metadata.modDate}`);

    const metadataBlock = metaLines.join('\n');

    const messages = [
      {
        role: 'system' as const,
        content: SUMMARY_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: SUMMARY_AGENT_SCANNED_PDF_PROMPT,
          },
          {
            type: 'text' as const,
            text: `SCANNED PDF METADATA:\n${metadataBlock || '[no metadata available]'}`,
          },
        ],
      },
    ];

    const summary = await executeApiCall<string>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient
    );

    return summary || fallback();
  }

  /**
   * Generate summary for images using vision-capable models
   */
  async summarizeImage(imageBuffer: Buffer, mimeType: string, extension: string): Promise<string> {
    const fallback = () => this.generateFallbackImage('', extension);
    const base64Image = imageBuffer.toString('base64');

    const messages = [
      {
        role: 'system' as const,
        content: SUMMARY_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: 'Analyze this image and generate a distinctive file management summary. Focus on: image type (screenshot/photo/scan/diagram), visible text content, context (app/program/document), people/dates if visible, and what makes this image unique and searchable.',
          },
          {
            type: 'image_url' as const,
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          },
        ],
      },
    ];

    const summary = await executeApiCall<string>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient
    );

    return summary || fallback();
  }

  /**
   * Generate summary for audio/video files
   */
  async summarizeAudio(transcription: string, extension: string): Promise<string> {
    if (transcription.length === 0) {
      const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'].includes(extension.toLowerCase());
      return `${isVideo ? 'Video' : 'Audio'} file (${extension.toUpperCase()}) - no speech detected`;
    }

    const fallback = () => this.generateFallbackAudio(transcription, extension);
    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'].includes(extension.toLowerCase());
    const mediaType = isVideo ? 'video' : 'audio';

    const textToAnalyze = transcription.length > 2000
      ? transcription.substring(0, 2000) + '\n[... transcription truncated ...]'
      : transcription;

    const messages = [
      {
        role: 'system' as const,
        content: SUMMARY_AGENT_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: SUMMARY_AGENT_AUDIO_PROMPT(mediaType, textToAnalyze),
      },
    ];

    const summary = await executeApiCall<string>(
      messages,
      fallback,
      this.workerPool,
      this.llmClient
    );

    return summary || fallback();
  }

  // Fallback methods
  private generateFallbackText(extension: string, content: string): string {
    const lines = content.split('\n');
    const isCodeFile = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'go', 'rs'].includes(extension.toLowerCase());
    const lineCount = lines.length;
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    
    if (content.length === 0) {
      return isCodeFile ? `Empty ${extension.toUpperCase()} code file` : `Empty ${extension.toUpperCase()} file`;
    }
    
    if (isCodeFile) {
      if (content.includes('function') || content.includes('def ') || content.includes('class ')) {
        const funcCount = (content.match(/(function|def |class )/g) || []).length;
        return `Code file with ${funcCount} function${funcCount !== 1 ? 's' : ''} or class${funcCount !== 1 ? 'es' : ''} (${lineCount} lines)`;
      }
      return `${extension.toUpperCase()} code file (${lineCount} lines)`;
    }
    
    if (extension === 'md' || extension === 'markdown') {
      return `Markdown document${wordCount > 0 ? ` (${wordCount} words)` : ''}`;
    }
    if (extension === 'json') {
      return `JSON data file`;
    }
    if (extension === 'yaml' || extension === 'yml') {
      return `YAML configuration file`;
    }
    if (extension === 'txt') {
      return `Text file${wordCount > 0 ? ` (${wordCount} words, ${lineCount} lines)` : ` (${lineCount} lines)`}`;
    }
    
    return `${extension.toUpperCase()} file${wordCount > 0 ? ` (${wordCount} words)` : ` (${lineCount} lines)`}`;
  }

  private generateFallbackPDF(text: string, metadata?: { title?: string; pages?: number }): string {
    const title = metadata?.title || '';
    const pages = metadata?.pages || 0;
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    
    if (title && title.length > 0 && title.length < 150) {
      return `PDF document: ${title}${pages > 0 ? ` (${pages} pages)` : ''}`;
    }
    
    if (text.length === 0) {
      return `PDF document${pages > 0 ? ` (${pages} pages)` : ''} - no text content`;
    }
    
    const lowerText = text.toLowerCase();
    if (lowerText.includes('invoice') || lowerText.includes('bill')) {
      return `Invoice or billing document (${pages} pages)`;
    }
    if (lowerText.includes('contract') || lowerText.includes('agreement')) {
      return `Contract or agreement document (${pages} pages)`;
    }
    if (lowerText.includes('report')) {
      return `Report document (${pages} pages, ${wordCount} words)`;
    }
    if (lowerText.includes('manual') || lowerText.includes('guide')) {
      return `Manual or guide document (${pages} pages)`;
    }
    
    return `PDF document (${pages} pages, ${wordCount} words)`;
  }

  private generateFallbackImage(description: string, extension: string): string {
    if (description.length === 0) {
      return `Image file (${extension.toUpperCase()})`;
    }
    
    const lowerDesc = description.toLowerCase();
    
    if (lowerDesc.includes('screenshot') || lowerDesc.includes('screen capture')) {
      return 'Screenshot image';
    }
    if (lowerDesc.includes('photo') || lowerDesc.includes('photograph')) {
      if (lowerDesc.includes('person') || lowerDesc.includes('people')) {
        return 'Photograph with people';
      }
      return 'Photograph';
    }
    if (lowerDesc.includes('diagram') || lowerDesc.includes('chart') || lowerDesc.includes('graph')) {
      return 'Diagram or chart';
    }
    if (lowerDesc.includes('document') || lowerDesc.includes('text')) {
      return 'Document image with text';
    }
    if (lowerDesc.includes('receipt') || lowerDesc.includes('invoice')) {
      return 'Receipt or invoice document';
    }
    
    const firstSentence = description.split(/[.!?]/)[0];
    if (firstSentence.length > 0 && firstSentence.length <= 150) {
      return firstSentence + '.';
    }
    
    return description.length > 150 ? description.substring(0, 150) + '...' : description;
  }

  private generateFallbackAudio(text: string, extension: string): string {
    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'].includes(extension.toLowerCase());
    const mediaType = isVideo ? 'video' : 'audio';
    
    if (text.length === 0) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} file (${extension.toUpperCase()}) - no speech detected`;
    }
    
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('meeting') || lowerText.includes('call')) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} recording: Meeting or call`;
    }
    if (lowerText.includes('interview')) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} recording: Interview`;
    }
    if (lowerText.includes('lecture') || lowerText.includes('presentation')) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} recording: Lecture or presentation`;
    }
    if (lowerText.includes('music') || lowerText.includes('song')) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} recording: Music`;
    }
    if (lowerText.includes('podcast')) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} recording: Podcast`;
    }
    
    const firstSentence = text.split(/[.!?]/)[0];
    if (firstSentence.length > 0 && firstSentence.length <= 150) {
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}: ${firstSentence}.`;
    }
    
    return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} recording (${text.length > 150 ? text.substring(0, 150) + '...' : text})`;
  }
}
