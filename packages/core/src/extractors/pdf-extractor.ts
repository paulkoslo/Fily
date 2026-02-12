import * as fs from 'fs';
import pdf from 'pdf-parse';
import type { Extractor, ExtractionResult, ExtractedContent } from './types';
import { truncateToWordLimit, withTimeout } from './extractor-utils';

// Global suppression of pdf-parse font warnings (set up once at module load)
let fontWarningSuppressionActive = false;

function setupFontWarningSuppression() {
  if (fontWarningSuppressionActive) return;
  fontWarningSuppressionActive = true;
  
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  
  const filterFontWarnings = (msg: string): boolean => {
    const lowerMsg = msg.toLowerCase();
    return !(
      lowerMsg.includes('tt: undefined function') ||
      lowerMsg.includes('warning: tt:') ||
      lowerMsg.includes('could not find a preferred cmap table') ||
      lowerMsg.includes('required "glyf" table is not found') ||
      (lowerMsg.includes('glyf') && lowerMsg.includes('table')) ||
      (lowerMsg.includes('cmap') && lowerMsg.includes('table'))
    );
  };
  
  process.stderr.write = function(chunk: any, encoding?: any, callback?: any): boolean {
    if (chunk) {
      const msg = chunk.toString();
      if (filterFontWarnings(msg)) {
        return originalStderrWrite(chunk, encoding, callback);
      }
      // Swallow font warnings
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  };
  
  process.stdout.write = function(chunk: any, encoding?: any, callback?: any): boolean {
    if (chunk) {
      const msg = chunk.toString();
      if (filterFontWarnings(msg)) {
        return originalStdoutWrite(chunk, encoding, callback);
      }
      // Swallow font warnings
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalStdoutWrite(chunk, encoding, callback);
  };
}

// Set up suppression immediately when module loads
setupFontWarningSuppression();

/**
 * PDF Extractor - extracts text from PDF files
 * Supports: .pdf
 */
export class PDFExtractor implements Extractor {
  readonly id = 'pdf-extractor';
  readonly version = '1.0.0';
  
  readonly supportedExtensions = ['pdf'];

  canExtract(extension: string): boolean {
    return this.supportedExtensions.includes(extension.toLowerCase());
  }

  async extract(filePath: string, extension: string): Promise<ExtractionResult> {
    try {
      // Check file size (skip files larger than 50MB)
      const stats = fs.statSync(filePath);
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (stats.size > maxSize) {
        return {
          success: false,
          content: null,
          error: `PDF too large (${Math.round(stats.size / 1024 / 1024)}MB), skipping`,
          extractorVersion: this.version,
        };
      }

      const dataBuffer = await withTimeout(
        fs.promises.readFile(filePath),
        60000, // 60 second timeout
        10000, // 10 second warning
        filePath
      );
      
      // Font warning suppression is already set up at module load time
      // Just parse the PDF - warnings will be automatically filtered
      const pdfData = await withTimeout(
        pdf(dataBuffer),
        60000, // 60 second timeout
        10000, // 10 second warning
        filePath
      );
      
      const rawText = pdfData.text || '';
      
      // Truncate to 1000 words max for scalability
      const extractedText = truncateToWordLimit(rawText);

      // Heuristic: if pdf-parse returns no text at all, treat this as an image-based (scanned) PDF
      const hasText = rawText.trim().length > 0; // Check original text, not truncated

      let extractedContent: ExtractedContent;

      if (!hasText) {
        // Image-based / scanned PDF: store original binary as "image" payload for the Summary Agent to OCR
        extractedContent = {
          contentType: 'pdf',
          extractedText: '', // No text available from pdf-parse
          summary: null,
          keywords: ['pdf', 'image-based', 'scan'],
          metadata: {
            pages: pdfData.numpages,
            title: pdfData.info?.Title || null,
            author: pdfData.info?.Author || null,
            subject: pdfData.info?.Subject || null,
            creator: pdfData.info?.Creator || null,
            producer: pdfData.info?.Producer || null,
            creationDate: pdfData.info?.CreationDate || null,
            modDate: pdfData.info?.ModDate || null,
            // Flags and payload for downstream agents
            isImageBased: true,
            // Store original PDF bytes so the Summary Agent can attempt vision/OCR as a fallback
            pdfBuffer: dataBuffer.toString('base64'),
            mimeType: 'application/pdf',
          },
        };
      } else {
        // Text-based PDF (normal case)
        // Extractors only extract raw content - classification is done by agents
        const summary: string | null = null;
        
        // Extract keywords from PDF text
        const keywords = this.extractKeywords(extractedText);
        
        extractedContent = {
          contentType: 'pdf',
          extractedText,
          summary: null, // Summary will be generated by classification agent
          keywords,
          metadata: {
            pages: pdfData.numpages,
            title: pdfData.info?.Title || null,
            author: pdfData.info?.Author || null,
            subject: pdfData.info?.Subject || null,
            creator: pdfData.info?.Creator || null,
            producer: pdfData.info?.Producer || null,
            creationDate: pdfData.info?.CreationDate || null,
            modDate: pdfData.info?.ModDate || null,
            isImageBased: false,
            originalWordCount: rawText.split(/\s+/).filter(w => w.length > 0).length,
            truncated: rawText.length !== extractedText.length,
          },
        };
      }

      return {
        success: true,
        content: extractedContent,
        extractorVersion: this.version,
      };
    } catch (error) {
      return {
        success: false,
        content: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        extractorVersion: this.version,
      };
    }
  }

  private extractKeywords(text: string): string[] {
    const keywords: string[] = ['pdf'];
    
    // Simple keyword extraction (can be improved)
    const commonWords = ['invoice', 'receipt', 'report', 'document', 'contract',
                         'agreement', 'proposal', 'presentation', 'manual', 'guide'];
    
    const lowerText = text.toLowerCase();
    for (const word of commonWords) {
      if (lowerText.includes(word)) {
        keywords.push(word);
      }
    }
    
    return [...new Set(keywords)];
  }
}
