import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type WatchEventType = 'add' | 'change' | 'unlink';

export interface NormalizedWatchEvent {
  type: WatchEventType;
  path: string;
  sourceId: number;
}

export type WatchEventHandler = (event: NormalizedWatchEvent) => void;

/**
 * SourceWatcher - Watches a single source directory for filesystem changes.
 * 
 * Uses Node.js fs.watch with recursive mode to monitor subdirectories.
 * Normalizes raw filesystem events into add/change/unlink events.
 * Implements debouncing to batch rapid events.
 */
export class SourceWatcher {
  private sourceId: number;
  private sourcePath: string;
  private onEvent: WatchEventHandler;
  private watcher: fs.FSWatcher | null = null;
  private isActive: boolean = false;
  private pendingEvents: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 500;

  constructor(sourceId: number, sourcePath: string, onEvent: WatchEventHandler) {
    this.sourceId = sourceId;
    this.sourcePath = path.resolve(sourcePath);
    this.onEvent = onEvent;
  }

  /**
   * Start watching the source directory.
   */
  start(): void {
    if (this.isActive) {
      console.warn(`[Watcher] Already watching source ${this.sourceId}`);
      return;
    }

    try {
      // Check if source path exists
      if (!fs.existsSync(this.sourcePath)) {
        console.warn(`[Watcher] Source path does not exist: ${this.sourcePath}`);
        return;
      }

      // Check if it's a directory
      const stats = fs.statSync(this.sourcePath);
      if (!stats.isDirectory()) {
        console.warn(`[Watcher] Source path is not a directory: ${this.sourcePath}`);
        return;
      }

      // Start watching with recursive mode
      this.watcher = fs.watch(this.sourcePath, { recursive: true }, (eventType, filename) => {
        this.handleRawEvent(eventType, filename);
      });

      this.isActive = true;
      console.log(`[Watcher] Started watching source ${this.sourceId}: ${this.sourcePath}`);
    } catch (error) {
      console.error(`[Watcher] Failed to start watching source ${this.sourceId}:`, error);
      // Continue watching even if there's an error (e.g., permission denied for some subdirs)
      this.isActive = false;
    }
  }

  /**
   * Stop watching the source directory.
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    // Clear all pending debounced events
    for (const timeout of this.pendingEvents.values()) {
      clearTimeout(timeout);
    }
    this.pendingEvents.clear();

    // Close the watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isActive = false;
    console.log(`[Watcher] Stopped watching source ${this.sourceId}`);
  }

  /**
   * Check if the watcher is currently active.
   */
  isWatching(): boolean {
    return this.isActive;
  }

  /**
   * Handle raw filesystem event from fs.watch.
   * Normalizes rename events by checking if file exists.
   */
  private handleRawEvent(eventType: string, filename: string | null): void {
    if (!filename) {
      return; // Ignore events without filename
    }

    // Construct full path - filename from fs.watch is relative to watched directory
    const fullPath = path.join(this.sourcePath, filename);
    
    // Skip excluded folders/files (check both filename and full path segments)
    const name = path.basename(filename);
    const pathParts = filename.split(path.sep);
    const shouldSkip = name.startsWith('.') || 
                       this.shouldExclude(name) ||
                       pathParts.some(part => part.startsWith('.') || this.shouldExclude(part));
    
    if (shouldSkip) {
      return;
    }

    // Normalize event type
    let normalizedType: WatchEventType;
    if (eventType === 'rename') {
      // Rename events can mean add or delete
      // Check if file exists to determine which
      try {
        if (fs.existsSync(fullPath)) {
          normalizedType = 'add';
        } else {
          normalizedType = 'unlink';
        }
      } catch {
        // If we can't check, assume unlink (file was deleted)
        normalizedType = 'unlink';
      }
    } else if (eventType === 'change') {
      normalizedType = 'change';
    } else {
      // Unknown event type, ignore
      return;
    }

    // Debounce the event
    this.debounceEvent(fullPath, normalizedType);
  }

  /**
   * Debounce events to batch rapid filesystem changes.
   * Uses a per-path timeout to ensure each file's events are batched separately.
   */
  private debounceEvent(filePath: string, eventType: WatchEventType): void {
    // Clear existing timeout for this path
    const existingTimeout = this.pendingEvents.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      this.pendingEvents.delete(filePath);
      this.processEvent(filePath, eventType);
    }, this.DEBOUNCE_MS);

    this.pendingEvents.set(filePath, timeout);
  }

  /**
   * Process a normalized event (after debouncing).
   */
  private processEvent(filePath: string, eventType: WatchEventType): void {
    try {
      // Double-check file existence for add/change events
      if (eventType === 'add' || eventType === 'change') {
        if (!fs.existsSync(filePath)) {
          // File was deleted between event and processing
          eventType = 'unlink';
        }
      }

      // Emit normalized event
      this.onEvent({
        type: eventType,
        path: filePath,
        sourceId: this.sourceId,
      });
    } catch (error) {
      // Log error but continue watching
      console.warn(`[Watcher] Error processing event for ${filePath}:`, error);
    }
  }

  /**
   * Check if a file/folder should be excluded from watching.
   */
  private shouldExclude(name: string): boolean {
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

    return EXCLUDED_FOLDERS.has(name);
  }
}
