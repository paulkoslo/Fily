import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { DatabaseManager } from '../db';

// Folders to exclude from indexing
const EXCLUDED_FOLDERS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.cache',
  '.npm',
  '.yarn',
  'venv',
  '.venv',
]);

// Batch size for database inserts
const BATCH_SIZE = 100;
// Maximum depth to prevent stack overflow (iterative walk handles this, but good to have a limit)
const MAX_DEPTH = 100;
// Progress reporting intervals
const PROGRESS_INTERVAL_SMALL = 100; // For folders with <10k files
const PROGRESS_INTERVAL_LARGE = 1000; // For folders with ≥10k files

export interface CrawlResult {
  filesScanned: number;
  foldersScanned: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  foldersRemoved: number;
  errors: string[];
}

export interface CrawlProgress {
  status: 'scanning' | 'indexing' | 'cleaning' | 'done' | 'error';
  currentFile?: string;
  filesFound: number;
  foldersFound: number;
  filesProcessed: number;
  message: string;
}

/**
 * Computes a stable file ID based on path, size, and mtime.
 */
export function computeFileId(filePath: string, size: number, mtime: number): string {
  const data = `${filePath}|${size}|${mtime}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

/**
 * Computes a stable folder ID based on path and mtime.
 */
export function computeFolderId(folderPath: string, mtime: number): string {
  const data = `folder|${folderPath}|${mtime}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

/**
 * Checks if a file or folder should be excluded from indexing.
 */
function shouldExclude(name: string): boolean {
  // Exclude hidden files/folders (starting with .)
  if (name.startsWith('.')) {
    return true;
  }
  // Exclude known problematic folders
  if (EXCLUDED_FOLDERS.has(name)) {
    return true;
  }
  return false;
}

interface FileInfo {
  filePath: string;
  name: string;
  extension: string;
  size: number;
  mtime: number;
  relativePath: string;
  parentPath: string | null;
}

interface FolderInfo {
  folderPath: string;
  name: string;
  mtime: number;
  relativePath: string;
  parentPath: string | null;
  depth: number;
  itemCount: number;
}

/**
 * Stack entry for iterative directory walk
 */
interface StackEntry {
  path: string;
  depth: number;
  relativePath: string;
  parentPath: string | null;
}

/**
 * Streamingly crawls a directory using iterative stack-based walk.
 * Processes files and folders as they're discovered via callbacks.
 * Memory efficient: only keeps a small stack of directories to process.
 */
function walkDirectoryStreaming(
  sourceRoot: string,
  onFile: (file: FileInfo) => void,
  onFolder: (folder: FolderInfo) => void,
  onError?: (error: string) => void
): { filesFound: number; foldersFound: number } {
  const stack: StackEntry[] = [];
  let filesFound = 0;
  let foldersFound = 0;
  
  function getRelativePath(fullPath: string): string {
    return path.relative(sourceRoot, fullPath);
  }

  function getParentPath(relativePath: string): string | null {
    const parent = path.dirname(relativePath);
    return parent === '.' || parent === '' ? null : parent;
  }

  // Start with root directory
  stack.push({
    path: sourceRoot,
    depth: 0,
    relativePath: '',
    parentPath: null,
  });

  // Iterative walk - processes directories from stack
  while (stack.length > 0) {
    const entry = stack.pop()!;
    const { path: currentPath, depth, relativePath: currentRelativePath, parentPath: currentParentPath } = entry;

    // Safety check: prevent excessive depth
    if (depth > MAX_DEPTH) {
      const errorMsg = `Maximum depth exceeded: ${currentPath}`;
      if (onError) {
        onError(errorMsg);
      }
      console.warn(errorMsg);
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
      // Permission denied or other error - skip this directory
      const errorMsg = `Cannot read directory ${currentPath}: ${err}`;
      if (onError) {
        onError(errorMsg);
      }
      console.warn(errorMsg);
      continue;
    }

    let directChildren = 0;
    const subdirectories: StackEntry[] = [];

    // Process entries: files immediately, directories added to stack
    for (const entry of entries) {
      if (shouldExclude(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      const relativePath = getRelativePath(fullPath);
      const parentPath = getParentPath(relativePath);

      if (entry.isDirectory()) {
        try {
          // Add to stack for later processing
          subdirectories.push({
            path: fullPath,
            depth: depth + 1,
            relativePath,
            parentPath: currentRelativePath || null,
          });
          
          directChildren++;
        } catch (err) {
          const errorMsg = `Cannot process folder ${fullPath}: ${err}`;
          if (onError) {
            onError(errorMsg);
          }
          console.warn(errorMsg);
        }
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          const extension = path.extname(entry.name).toLowerCase().slice(1);
          
          // Process file immediately (streaming)
          onFile({
            filePath: fullPath,
            name: entry.name,
            extension,
            size: stats.size,
            mtime: stats.mtimeMs,
            relativePath,
            parentPath: currentRelativePath || null,
          });
          
          filesFound++;
          directChildren++;
        } catch (err) {
          const errorMsg = `Cannot stat file ${fullPath}: ${err}`;
          if (onError) {
            onError(errorMsg);
          }
          console.warn(errorMsg);
        }
      }
    }

    // Add subdirectories to stack (in reverse order for depth-first processing)
    for (let i = subdirectories.length - 1; i >= 0; i--) {
      stack.push(subdirectories[i]);
    }

    // Process folder after processing its direct children
    // Note: itemCount uses direct children only for memory efficiency
    // (exact total counts would require storing folder relationships)
    if (currentPath !== sourceRoot) {
      try {
        const stats = fs.statSync(currentPath);
        onFolder({
          folderPath: currentPath,
          name: path.basename(currentPath),
          mtime: stats.mtimeMs,
          relativePath: currentRelativePath,
          parentPath: currentParentPath,
          depth,
          itemCount: directChildren, // Direct children only for memory efficiency
        });
        foldersFound++;
      } catch (err) {
        const errorMsg = `Cannot stat folder ${currentPath}: ${err}`;
        if (onError) {
          onError(errorMsg);
        }
        console.warn(errorMsg);
      }
    }
  }

  return { filesFound, foldersFound };
}

/**
 * Crawler class that indexes files and folders from a source directory into the database.
 * Uses streaming processing to minimize memory usage.
 */
export class Crawler {
  constructor(private db: DatabaseManager) {}

  /**
   * Scans a source directory and updates the database.
   * Uses streaming processing to keep memory usage under 500MB.
   * Returns statistics about the crawl.
   */
  async scan(
    sourceId: number,
    sourcePath: string,
    onProgress?: (progress: CrawlProgress) => void
  ): Promise<CrawlResult> {
    const result: CrawlResult = {
      filesScanned: 0,
      foldersScanned: 0,
      filesAdded: 0,
      filesUpdated: 0,
      filesRemoved: 0,
      foldersRemoved: 0,
      errors: [],
    };

    const reportProgress = (progress: CrawlProgress) => {
      if (onProgress) {
        onProgress(progress);
      }
    };

    // Verify source path exists
    if (!fs.existsSync(sourcePath)) {
      result.errors.push(`Source path does not exist: ${sourcePath}`);
      reportProgress({
        status: 'error',
        filesFound: 0,
        foldersFound: 0,
        filesProcessed: 0,
        message: `Source path does not exist: ${sourcePath}`,
      });
      return result;
    }

    // Phase 0: Check for parent sources and link to them (virtual filesystem)
    console.log(`[Crawler] Checking for parent sources for: ${sourcePath}`);
    const parentSources = await this.db.getParentSources(sourcePath);
    console.log(`[Crawler] Found ${parentSources.length} parent source(s):`, parentSources.map(s => `${s.name} (${s.path})`));
    
    if (parentSources.length > 0) {
      const parentSource = parentSources[0]; // Use most specific parent (longest path)
      console.log(`[Crawler] Linking to parent source: ${parentSource.name} (${parentSource.path})`);
      
      try {
        // Link this source to its parent (creates virtual filesystem link)
        await this.db.linkSourceToParent(sourceId, parentSource.id);
        
        reportProgress({
          status: 'scanning',
          filesFound: 0,
          foldersFound: 0,
          filesProcessed: 0,
          message: `Linked to parent source "${parentSource.name}". Files will be available without rescanning.`,
        });
        
        // Skip scanning - files from parent source will be available via virtual link
        // Only scan if parent source hasn't been scanned yet (check file count)
        const parentFileCount = await this.db.getFileCount(parentSource.id);
        if (parentFileCount === 0) {
          reportProgress({
            status: 'scanning',
            filesFound: 0,
            foldersFound: 0,
            filesProcessed: 0,
            message: `Parent source "${parentSource.name}" has no files. Scanning parent first...`,
          });
          // Parent needs to be scanned first - return early with instruction
          result.errors.push(`Parent source "${parentSource.name}" needs to be scanned first. Please scan the parent source before scanning this nested source.`);
          return result;
        }
        
        // Parent has files, so we can skip scanning this nested source
        // Files will be available via virtual link
        reportProgress({
          status: 'done',
          filesFound: 0,
          foldersFound: 0,
          filesProcessed: 0,
          message: `Source linked to parent "${parentSource.name}". ${parentFileCount} files available via virtual link.`,
        });
        
        result.filesScanned = 0;
        result.foldersScanned = 0;
        return result;
      } catch (err) {
        const errorMsg = `Failed to link to parent source: ${err}`;
        result.errors.push(errorMsg);
        console.warn(errorMsg);
        // Continue with normal scan if linking fails
      }
    }

    // Phase 1: Stream filesystem scan and index as we go
    reportProgress({
      status: 'scanning',
      filesFound: 0,
      foldersFound: 0,
      filesProcessed: 0,
      message: 'Scanning filesystem...',
    });

    // Track scanned IDs (Sets are memory efficient - only 40 bytes per ID)
    const scannedFileIds = new Set<string>();
    const scannedFolderIds = new Set<string>();

    // Batch arrays for database inserts (limited size for memory efficiency)
    let fileBatch: Array<{
      fileId: string;
      filePath: string;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      sourceId: number;
      relativePath: string;
      parentPath: string | null;
    }> = [];

    let folderBatch: Array<{
      folderId: string;
      folderPath: string;
      name: string;
      relativePath: string;
      parentPath: string | null;
      depth: number;
      sourceId: number;
      itemCount: number;
      mtime: number;
    }> = [];

    let filesProcessed = 0;
    let foldersProcessed = 0;
    let filesFound = 0;
    let foldersFound = 0;
    let lastProgressReport = 0;

    // Stream processing: process files and folders as they're discovered
    const walkResult = walkDirectoryStreaming(
      sourcePath,
      // onFile callback - process file immediately
      (file) => {
        filesFound++;
        const fileId = computeFileId(file.filePath, file.size, file.mtime);
        scannedFileIds.add(fileId);

        fileBatch.push({
          fileId,
          filePath: file.filePath,
          name: file.name,
          extension: file.extension,
          size: file.size,
          mtime: file.mtime,
          sourceId,
          relativePath: file.relativePath,
          parentPath: file.parentPath,
        });

        // Process batch when full
        if (fileBatch.length >= BATCH_SIZE) {
          this.processFileBatch(fileBatch, result);
          filesProcessed += fileBatch.length;
          fileBatch = [];

          // Report progress (adjust interval based on file count)
          const progressInterval = filesFound >= 10000 ? PROGRESS_INTERVAL_LARGE : PROGRESS_INTERVAL_SMALL;
          if (filesProcessed - lastProgressReport >= progressInterval || filesFound < 10000) {
            reportProgress({
              status: 'indexing',
              currentFile: file.name,
              filesFound,
              foldersFound,
              filesProcessed,
              message: `Indexed ${filesProcessed}/${filesFound} files...`,
            });
            lastProgressReport = filesProcessed;
          }
        }
      },
      // onFolder callback - process folder immediately
      (folder) => {
        foldersFound++;
        const folderId = computeFolderId(folder.folderPath, folder.mtime);
        scannedFolderIds.add(folderId);

        folderBatch.push({
          folderId,
          folderPath: folder.folderPath,
          name: folder.name,
          relativePath: folder.relativePath,
          parentPath: folder.parentPath,
          depth: folder.depth,
          sourceId,
          itemCount: folder.itemCount,
          mtime: folder.mtime,
        });

        // Process batch when full
        if (folderBatch.length >= BATCH_SIZE) {
          this.processFolderBatch(folderBatch, result);
          foldersProcessed += folderBatch.length;
          folderBatch = [];
        }
      },
      // onError callback
      (error) => {
        result.errors.push(error);
      }
    );

    // Process remaining batches
    if (fileBatch.length > 0) {
      await this.processFileBatch(fileBatch, result);
      filesProcessed += fileBatch.length;
    }
    if (folderBatch.length > 0) {
      await this.processFolderBatch(folderBatch, result);
      foldersProcessed += folderBatch.length;
    }

    result.filesScanned = walkResult.filesFound;
    result.foldersScanned = walkResult.foldersFound;

    reportProgress({
      status: 'indexing',
      filesFound: walkResult.filesFound,
      foldersFound: walkResult.foldersFound,
      filesProcessed,
      message: `Indexed ${walkResult.filesFound} files and ${walkResult.foldersFound} folders`,
    });

    // Phase 2: Clean up removed files and folders
    reportProgress({
      status: 'cleaning',
      filesFound: walkResult.filesFound,
      foldersFound: walkResult.foldersFound,
      filesProcessed,
      message: `Cleaning up removed items (found ${walkResult.filesFound} files, ${scannedFileIds.size} in database)...`,
    });

    try {
      // Cleanup can take a while for large datasets - report progress
      const startTime = Date.now();
      result.filesRemoved = await this.db.deleteFilesNotInSetOptimized(sourceId, scannedFileIds);
      const cleanupTime = Date.now() - startTime;
      
      if (result.filesRemoved > 0) {
        reportProgress({
          status: 'cleaning',
          filesFound: walkResult.filesFound,
          foldersFound: walkResult.foldersFound,
          filesProcessed,
          message: `Removed ${result.filesRemoved} deleted files (took ${(cleanupTime / 1000).toFixed(1)}s)`,
        });
      }
    } catch (err) {
      const errorMsg = `Failed to clean up removed files: ${err}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
      reportProgress({
        status: 'error',
        filesFound: walkResult.filesFound,
        foldersFound: walkResult.foldersFound,
        filesProcessed,
        message: `Error during cleanup: ${errorMsg}`,
      });
      // Don't throw - continue with folder cleanup
    }

    try {
      result.foldersRemoved = await this.db.deleteFoldersNotInSetOptimized(sourceId, scannedFolderIds);
      if (result.foldersRemoved > 0) {
        reportProgress({
          status: 'cleaning',
          filesFound: walkResult.filesFound,
          foldersFound: walkResult.foldersFound,
          filesProcessed,
          message: `Removed ${result.foldersRemoved} deleted folders`,
        });
      }
    } catch (err) {
      const errorMsg = `Failed to clean up removed folders: ${err}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
      reportProgress({
        status: 'error',
        filesFound: walkResult.filesFound,
        foldersFound: walkResult.foldersFound,
        filesProcessed,
        message: `Error during folder cleanup: ${errorMsg}`,
      });
    }

    // Save database once at end of scan operation
    this.db.saveSync();

    reportProgress({
      status: 'done',
      filesFound: walkResult.filesFound,
      foldersFound: walkResult.foldersFound,
      filesProcessed,
      message: `Done: ${walkResult.filesFound} files, ${walkResult.foldersFound} folders indexed`,
    });

    return result;
  }

  /**
   * Helper method to process a batch of files
   */
  private async processFileBatch(
    fileBatch: Array<{
      fileId: string;
      filePath: string;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      sourceId: number;
      relativePath: string;
      parentPath: string | null;
    }>,
    result: CrawlResult
  ): Promise<void> {
    try {
      await this.db.upsertFileBatch(fileBatch);
    } catch (err) {
      const errorMsg = `Failed to index file batch: ${err}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
    }
  }

  /**
   * Helper method to process a batch of folders
   */
  private async processFolderBatch(
    folderBatch: Array<{
      folderId: string;
      folderPath: string;
      name: string;
      relativePath: string;
      parentPath: string | null;
      depth: number;
      sourceId: number;
      itemCount: number;
      mtime: number;
    }>,
    result: CrawlResult
  ): Promise<void> {
    try {
      await this.db.upsertFolderBatch(folderBatch);
    } catch (err) {
      const errorMsg = `Failed to index folder batch: ${err}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
    }
  }
}
