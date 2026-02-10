import type { DatabaseManager } from '../db';
import { SourceWatcher, type NormalizedWatchEvent } from './watcher';
import * as fs from 'fs';
import * as path from 'path';
import { computeFileId } from './crawler';

/**
 * WatcherManager - Manages multiple SourceWatcher instances.
 * 
 * Handles starting/stopping watchers for sources and processes
 * filesystem events by updating the database and emitting IPC events.
 */
export class WatcherManager {
  private db: DatabaseManager;
  private watchers: Map<number, SourceWatcher> = new Map();
  private onFileChangedCallback: ((event: NormalizedWatchEvent) => void) | null = null;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /**
   * Set callback for file changed events (for IPC emission).
   */
  setOnFileChangedCallback(callback: (event: NormalizedWatchEvent) => void): void {
    this.onFileChangedCallback = callback;
  }

  /**
   * Start watching a source directory.
   */
  startWatching(sourceId: number, sourcePath: string): void {
    // Stop existing watcher if any
    this.stopWatching(sourceId);

    // Create and start new watcher
    const watcher = new SourceWatcher(sourceId, sourcePath, (event) => {
      this.handleEvent(event);
    });

    watcher.start();
    this.watchers.set(sourceId, watcher);
  }

  /**
   * Stop watching a source directory.
   */
  stopWatching(sourceId: number): void {
    const watcher = this.watchers.get(sourceId);
    if (watcher) {
      watcher.stop();
      this.watchers.delete(sourceId);
    }
  }

  /**
   * Stop all watchers.
   */
  stopAll(): void {
    for (const [sourceId, watcher] of this.watchers.entries()) {
      watcher.stop();
    }
    this.watchers.clear();
  }

  /**
   * Check if a source is being watched.
   */
  isWatching(sourceId: number): boolean {
    const watcher = this.watchers.get(sourceId);
    return watcher ? watcher.isWatching() : false;
  }

  /**
   * Get all source IDs that are currently being watched.
   */
  getAllWatchingSourceIds(): number[] {
    return Array.from(this.watchers.keys()).filter((id) => this.isWatching(id));
  }

  /**
   * Handle a normalized watch event.
   * Updates database and emits IPC event.
   */
  private async handleEvent(event: NormalizedWatchEvent): Promise<void> {
    try {
      const { type, path: filePath, sourceId } = event;
      console.log(`[WatcherManager] Handling event: ${type} for ${filePath} (source ${sourceId})`);

      // Verify source exists before processing
      const source = await this.db.getSourceById(sourceId);
      if (!source) {
        console.warn(`[WatcherManager] Source ${sourceId} does not exist, skipping event`);
        return;
      }

      // Insert event into database (will handle foreign key errors gracefully)
      await this.db.insertEvent({
        sourceId,
        type,
        path: filePath,
      });

      // Update file record based on event type
      if (type === 'add' || type === 'change') {
        await this.handleFileAddedOrChanged(filePath, sourceId);
      } else if (type === 'unlink') {
        console.log(`[WatcherManager] Processing unlink event for ${filePath}`);
        await this.handleFileDeleted(filePath, sourceId);
      }

      // Emit IPC event if callback is set
      if (this.onFileChangedCallback) {
        console.log(`[WatcherManager] Emitting IPC event for ${filePath}`);
        this.onFileChangedCallback(event);
      } else {
        console.warn(`[WatcherManager] No callback set for file changed events`);
      }
    } catch (error) {
      console.error(`[WatcherManager] Error handling event:`, error);
      // Don't re-throw - continue watching even if one event fails
    }
  }

  /**
   * Handle file added or changed event.
   * Updates or creates file record in database.
   */
  private async handleFileAddedOrChanged(filePath: string, sourceId: number): Promise<void> {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return; // File was deleted before we could process it
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return; // Not a file (might be a directory)
      }

      // Get source to compute relative path
      const source = await this.db.getSourceById(sourceId);
      if (!source) {
        return;
      }

      const relativePath = path.relative(source.path, filePath);
      // Handle case where file is at root of source (relativePath might be just filename)
      const parentPath = path.dirname(relativePath) === '.' || path.dirname(relativePath) === relativePath
        ? null 
        : path.dirname(relativePath);
      const name = path.basename(filePath);
      const extension = path.extname(name).slice(1); // Remove leading dot

      // Compute file ID
      const fileId = computeFileId(filePath, stats.size, stats.mtimeMs);

      // Upsert file record (will set status='present' and last_seen)
      await this.db.upsertFile(
        fileId,
        filePath,
        name,
        extension,
        stats.size,
        stats.mtimeMs,
        sourceId,
        relativePath,
        parentPath
      );
    } catch (error) {
      // Log but don't throw - continue watching
      console.warn(`[WatcherManager] Error handling file add/change for ${filePath}:`, error);
    }
  }

  /**
   * Handle file deleted event.
   * Marks file as missing in database.
   * Optimized: Try watched source first (fast), then search all sources if needed.
   */
  private async handleFileDeleted(filePath: string, sourceId: number): Promise<void> {
    try {
      // Try watched source first (fast - uses source_id index)
      let fileRecord = await this.db.getFileByPath(sourceId, filePath);
      
      // If not found, might belong to parent source - search all sources (slower but rare)
      if (!fileRecord) {
        fileRecord = await this.db.findFileByPath(filePath);
      }
      
      if (fileRecord) {
        // Mark as missing
        await this.db.markFileMissing(fileRecord.file_id);
      }
    } catch (error) {
      // Log but don't throw - continue watching
      console.error(`[WatcherManager] Error handling file delete for ${filePath}:`, error);
    }
  }
}
