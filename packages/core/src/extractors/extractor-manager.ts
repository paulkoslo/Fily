import { TextExtractor } from './text-extractor';
import { PDFExtractor } from './pdf-extractor';
import { ImageExtractor } from './image-extractor';
import { AudioExtractor } from './audio-extractor';
import { DocxExtractor } from './docx-extractor';
import { XlsxExtractor } from './xlsx-extractor';
import { PptxExtractor } from './pptx-extractor';
import type { Extractor, ExtractionResult } from './types';
import type { WorkerPool } from '../agents/worker-pool';

/**
 * ExtractorManager - manages all extractors and routes files to appropriate extractor
 */
export class ExtractorManager {
  private extractors: Extractor[];

  constructor(workerPool?: WorkerPool) {
    this.extractors = [
      new TextExtractor(),
      new PDFExtractor(),
      new DocxExtractor(),
      new XlsxExtractor(),
      new PptxExtractor(),
      new ImageExtractor(),
      new AudioExtractor(workerPool), // AudioExtractor uses Whisper API (counts as worker)
    ];
  }

  /**
   * Find the appropriate extractor for a file extension
   */
  findExtractor(extension: string): Extractor | null {
    for (const extractor of this.extractors) {
      if (extractor.canExtract(extension)) {
        return extractor;
      }
    }
    return null;
  }

  /**
   * Extract content from a file
   */
  async extract(filePath: string, extension: string): Promise<ExtractionResult> {
    const extractor = this.findExtractor(extension);
    
    if (!extractor) {
      return {
        success: false,
        content: null,
        error: `No extractor found for extension: ${extension}`,
        extractorVersion: 'none',
      };
    }

    return await extractor.extract(filePath, extension);
  }

  /**
   * Get all supported extensions
   */
  getSupportedExtensions(): string[] {
    const extensions = new Set<string>();
    for (const extractor of this.extractors) {
      for (const ext of extractor.supportedExtensions) {
        extensions.add(ext);
      }
    }
    return Array.from(extensions);
  }
}
