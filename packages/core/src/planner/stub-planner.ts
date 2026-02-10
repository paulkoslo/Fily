import type { FileRecord, PlannerOutput } from '../ipc/contracts';
import type { Planner } from './index';

/**
 * Extension-based category mapping.
 * Used by StubPlanner to assign virtual paths based on file type.
 */
const EXTENSION_CATEGORIES: Record<string, string> = {
  // Documents
  pdf: 'Documents/PDFs',
  doc: 'Documents/Word',
  docx: 'Documents/Word',
  txt: 'Documents/Text',
  md: 'Documents/Markdown',
  rtf: 'Documents/Text',
  odt: 'Documents/Text',

  // Spreadsheets
  xls: 'Documents/Spreadsheets',
  xlsx: 'Documents/Spreadsheets',
  csv: 'Documents/Spreadsheets',
  numbers: 'Documents/Spreadsheets',

  // Presentations
  ppt: 'Documents/Presentations',
  pptx: 'Documents/Presentations',
  key: 'Documents/Presentations',

  // Images
  jpg: 'Images',
  jpeg: 'Images',
  png: 'Images',
  gif: 'Images',
  webp: 'Images',
  svg: 'Images',
  ico: 'Images',
  bmp: 'Images',
  tiff: 'Images',
  heic: 'Images',

  // Videos
  mp4: 'Videos',
  mov: 'Videos',
  avi: 'Videos',
  mkv: 'Videos',
  webm: 'Videos',
  m4v: 'Videos',

  // Audio
  mp3: 'Audio',
  wav: 'Audio',
  flac: 'Audio',
  aac: 'Audio',
  ogg: 'Audio',
  m4a: 'Audio',

  // Archives
  zip: 'Archives',
  tar: 'Archives',
  gz: 'Archives',
  rar: 'Archives',
  '7z': 'Archives',
  dmg: 'Archives/Disk Images',
  iso: 'Archives/Disk Images',

  // Code
  js: 'Code/JavaScript',
  ts: 'Code/TypeScript',
  jsx: 'Code/JavaScript',
  tsx: 'Code/TypeScript',
  py: 'Code/Python',
  rb: 'Code/Ruby',
  go: 'Code/Go',
  rs: 'Code/Rust',
  java: 'Code/Java',
  c: 'Code/C',
  cpp: 'Code/C++',
  h: 'Code/C',
  hpp: 'Code/C++',
  swift: 'Code/Swift',
  kt: 'Code/Kotlin',
  sh: 'Code/Shell',
  bash: 'Code/Shell',
  zsh: 'Code/Shell',
  json: 'Code/Data',
  yaml: 'Code/Data',
  yml: 'Code/Data',
  xml: 'Code/Data',
  html: 'Code/Web',
  css: 'Code/Web',
  scss: 'Code/Web',
  less: 'Code/Web',

  // Applications
  app: 'Applications',
  exe: 'Applications',
  pkg: 'Applications/Installers',

  // Fonts
  ttf: 'Fonts',
  otf: 'Fonts',
  woff: 'Fonts',
  woff2: 'Fonts',
};

/**
 * StubPlanner - A simple rule-based planner for Phase 0.
 * 
 * Categorizes files based on their extension into a virtual folder structure.
 * This will be replaced by llama-fs integration in Phase 4.
 */
export class StubPlanner implements Planner {
  readonly id = 'stub-planner';
  readonly version = '0.1.0';

  async plan(files: FileRecord[]): Promise<PlannerOutput[]> {
    return files.map((file) => this.planSingleFile(file));
  }

  private planSingleFile(file: FileRecord): PlannerOutput {
    const ext = file.extension.toLowerCase();
    const category = EXTENSION_CATEGORIES[ext] || 'Other';

    // Build virtual path
    const virtualPath = `/${category}/${file.name}`;

    // Generate tags based on extension and category
    const tags = this.generateTags(file, category);

    return {
      file_id: file.file_id,
      virtual_path: virtualPath,
      tags,
      confidence: 0.7, // Stub planner has moderate confidence
      reason: `Categorized by extension: .${ext} → ${category}`,
    };
  }

  private generateTags(file: FileRecord, category: string): string[] {
    const tags: string[] = [];

    // Add extension as tag
    if (file.extension) {
      tags.push(file.extension.toLowerCase());
    }

    // Add category path parts as tags
    const categoryParts = category.split('/');
    for (const part of categoryParts) {
      tags.push(part.toLowerCase());
    }

    // Add size-based tag
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 100) {
      tags.push('large-file');
    } else if (sizeMB > 10) {
      tags.push('medium-file');
    } else {
      tags.push('small-file');
    }

    // Add recency tag
    const daysSinceModified = (Date.now() - file.mtime) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 1) {
      tags.push('today');
    } else if (daysSinceModified < 7) {
      tags.push('this-week');
    } else if (daysSinceModified < 30) {
      tags.push('this-month');
    }

    return [...new Set(tags)]; // Deduplicate
  }
}
