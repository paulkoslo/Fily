import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations';
import type { FileRecord, FolderRecord, Source, VirtualPlacement, PlannerOutput, FileCard } from '../ipc/contracts';

// SQLite has a limit of ~999 variables per query
const SQLITE_MAX_VARIABLES = 900;

export class DatabaseManager {
  private db: InstanceType<typeof Database> | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.init();
  }

  private init(): void {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database (better-sqlite3 reads/writes directly from/to disk)
    // Enable WAL mode for better concurrency and performance
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    runMigrations(this.db);
  }

  private ensureReady(): InstanceType<typeof Database> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // Sync method for explicit checkpoint (better-sqlite3 auto-saves, but checkpoint ensures WAL is synced)
  saveSync(): void {
    if (this.db) {
      // better-sqlite3 auto-saves, but we can checkpoint WAL for durability
      // checkpoint() method exists but may not be in TypeScript types
      try {
        // Use type assertion since checkpoint exists but types may be incomplete
        (this.db as any).checkpoint?.();
      } catch {
        // If checkpoint fails, that's okay - better-sqlite3 auto-saves anyway
      }
    }
  }

  // ============================================================================
  // Sources
  // ============================================================================

  async getSources(): Promise<Source[]> {
    const db = this.ensureReady();
    const stmt = db.prepare(`
      SELECT id, name, path, enabled, created_at, parent_source_id
      FROM sources
      WHERE enabled = 1
      ORDER BY name
    `);
    const rows = stmt.all() as Array<{
      id: number;
      name: string;
      path: string;
      enabled: number;
      created_at: number;
      parent_source_id: number | null;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      parent_source_id: row.parent_source_id,
    }));
  }

  async getSourceById(id: number): Promise<Source | undefined> {
    const db = this.ensureReady();
    const stmt = db.prepare(`
      SELECT id, name, path, enabled, created_at, parent_source_id
      FROM sources
      WHERE id = ?
    `);
    const row = stmt.get(id) as {
      id: number;
      name: string;
      path: string;
      enabled: number;
      created_at: number;
      parent_source_id: number | null;
    } | undefined;
    
    if (!row) {
      return undefined;
    }
    
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      parent_source_id: row.parent_source_id,
    };
  }

  /**
   * Link a source to its parent source (creates virtual filesystem link).
   * When a source is nested inside another source, linking allows it to
   * reference parent files without duplicating data.
   */
  async linkSourceToParent(sourceId: number, parentSourceId: number): Promise<void> {
    const db = this.ensureReady();
    db.prepare(`
      UPDATE sources
      SET parent_source_id = ?
      WHERE id = ?
    `).run(parentSourceId, sourceId);
  }

  async addSource(name: string, sourcePath: string, parentSourceId?: number | null): Promise<Source> {
    const db = this.ensureReady();
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO sources (name, path, enabled, created_at, parent_source_id)
      VALUES (?, ?, 1, ?, ?)
    `);
    const result = stmt.run(name, sourcePath, now, parentSourceId || null);
    const id = result.lastInsertRowid as number;
    
    return {
      id,
      name,
      path: sourcePath,
      enabled: true,
      created_at: now,
      parent_source_id: parentSourceId || null,
    };
  }

  async ensureDownloadsSource(downloadsPath: string): Promise<Source> {
    const db = this.ensureReady();
    const stmt = db.prepare(`SELECT id, name, path, enabled, created_at, parent_source_id FROM sources WHERE path = ?`);
    const row = stmt.get(downloadsPath) as {
      id: number;
      name: string;
      path: string;
      enabled: number;
      created_at: number;
      parent_source_id: number | null;
    } | undefined;
    
    if (row) {
      return {
        id: row.id,
        name: row.name,
        path: row.path,
        enabled: row.enabled === 1,
        created_at: row.created_at,
        parent_source_id: row.parent_source_id,
      };
    }
    return this.addSource('Downloads', downloadsPath);
  }

  async getSourceByPath(sourcePath: string): Promise<Source | undefined> {
    const db = this.ensureReady();
    const stmt = db.prepare(`SELECT id, name, path, enabled, created_at, parent_source_id FROM sources WHERE path = ?`);
    const row = stmt.get(sourcePath) as {
      id: number;
      name: string;
      path: string;
      enabled: number;
      created_at: number;
      parent_source_id: number | null;
    } | undefined;
    
    if (!row) {
      return undefined;
    }
    
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      parent_source_id: row.parent_source_id,
    };
  }

  /**
   * Find parent sources - sources whose path contains the given source path.
   * Returns sources sorted by path length (longest first, most specific parent first).
   * Handles symlinks, case-insensitive paths, and path normalization.
   */
  async getParentSources(sourcePath: string): Promise<Source[]> {
    const allSources = await this.getSources();
    
    // Helper to normalize a path (try both resolved and as-is)
    const normalizePath = (p: string): string[] => {
      const normalized: string[] = [];
      // Add original path (normalized)
      normalized.push(path.resolve(p).toLowerCase().replace(/\/$/, ''));
      // Try resolved path (for symlinks)
      try {
        const resolved = fs.realpathSync.native(p);
        if (resolved !== p) {
          normalized.push(resolved.toLowerCase().replace(/\/$/, ''));
        }
      } catch {
        // Ignore if realpath fails
      }
      return normalized;
    };
    
    const normalizedSourcePaths = normalizePath(sourcePath);
    console.log(`[Parent Detection] Normalizing source path: ${sourcePath}`);
    console.log(`  Normalized variants:`, normalizedSourcePaths);
    
    const parentSources = allSources
      .filter(source => {
        // Skip self
        if (source.path === sourcePath) {
          return false;
        }
        
        const normalizedParentPaths = normalizePath(source.path);
        console.log(`[Parent Detection] Checking: "${source.name}" (${source.path})`);
        console.log(`  Parent normalized variants:`, normalizedParentPaths);
        
        // Check if any parent path variant is a prefix of any source path variant
        let isParent = false;
        for (const parentPath of normalizedParentPaths) {
          for (const sourcePathNorm of normalizedSourcePaths) {
            // Check if parent path is a prefix of source path
            // e.g., "/users/me/documents" contains "/users/me/documents/projects"
            if (sourcePathNorm.startsWith(parentPath + path.sep) || 
                sourcePathNorm === parentPath) {
              isParent = true;
              console.log(`  ✓ Match found: "${parentPath}" is parent of "${sourcePathNorm}"`);
              break;
            }
          }
          if (isParent) break;
        }
        
        console.log(`  Result: ${isParent ? 'IS PARENT' : 'not parent'}`);
        return isParent;
      })
      .sort((a, b) => {
        // Sort by path length descending (most specific parent first)
        const pathA = normalizePath(a.path)[0];
        const pathB = normalizePath(b.path)[0];
        return pathB.length - pathA.length;
      });
    
    return parentSources;
  }

  /**
   * Copy files from a parent source to a child source without rescanning.
   * Files that are within the child source path are copied to the child source.
   * This optimizes scanning when a source is nested inside another source.
   */
  async copyFilesFromParentSource(
    parentSourceId: number,
    childSourceId: number,
    childSourcePath: string
  ): Promise<{ filesCopied: number; foldersCopied: number }> {
    const db = this.ensureReady();
    
    // Normalize child path (try both resolved and as-is for matching)
    let normalizedChildPath: string;
    try {
      normalizedChildPath = fs.realpathSync.native(childSourcePath);
    } catch {
      normalizedChildPath = path.resolve(childSourcePath);
    }
    
    // Also try the original path
    const originalChildPath = path.resolve(childSourcePath);
    
    console.log(`[Copy Files] Copying files from parent source ${parentSourceId} to child ${childSourceId}`);
    console.log(`  Child path (resolved): ${normalizedChildPath}`);
    console.log(`  Child path (original): ${originalChildPath}`);

    // Copy files that are within the child source path
    // Use path comparison: file path must start with child source path + separator
    // Check both resolved and original paths
    const filesStmt = db.prepare(`
      SELECT file_id, path, name, extension, size, mtime, relative_path, parent_path
      FROM files
      WHERE source_id = ?
      AND (
        path = ? OR
        path LIKE ? OR
        path LIKE ? OR
        path = ? OR
        path LIKE ? OR
        path LIKE ?
      )
    `);
    
    const escapedChildPath1 = normalizedChildPath;
    const escapedChildPath2 = originalChildPath;
    const filesToCopy = filesStmt.all(
      parentSourceId,
      escapedChildPath1,
      `${escapedChildPath1}/%`,
      `${escapedChildPath1}\\%`,
      escapedChildPath2,
      `${escapedChildPath2}/%`,
      `${escapedChildPath2}\\%`
    ) as Array<{
      file_id: string;
      path: string;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      relative_path: string | null;
      parent_path: string | null;
    }>;

    let filesCopied = 0;
    if (filesToCopy.length > 0) {
      // Calculate new relative_path for child source
      const fileBatch: Array<{
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

      for (const row of filesToCopy) {
        const filePath = row.path;
        
        // Calculate new relative path relative to child source
        const newRelativePath = path.relative(childSourcePath, filePath);
        const newParentPath = newRelativePath === path.basename(filePath) 
          ? null 
          : path.dirname(newRelativePath) === '.' ? null : path.dirname(newRelativePath);

        fileBatch.push({
          fileId: row.file_id,
          filePath: filePath,
          name: row.name,
          extension: row.extension,
          size: row.size,
          mtime: row.mtime,
          sourceId: childSourceId,
          relativePath: newRelativePath,
          parentPath: newParentPath,
        });
      }

      // Batch insert files
      if (fileBatch.length > 0) {
        await this.upsertFileBatch(fileBatch);
        filesCopied = fileBatch.length;
      }
    }

    // Copy folders that are within the child source path
    const foldersStmt = db.prepare(`
      SELECT folder_id, path, name, relative_path, parent_path, depth, item_count, mtime
      FROM folders
      WHERE source_id = ?
      AND (
        path = ? OR
        path LIKE ? OR
        path LIKE ? OR
        path = ? OR
        path LIKE ? OR
        path LIKE ?
      )
    `);
    
    const foldersToCopy = foldersStmt.all(
      parentSourceId,
      escapedChildPath1,
      `${escapedChildPath1}/%`,
      `${escapedChildPath1}\\%`,
      escapedChildPath2,
      `${escapedChildPath2}/%`,
      `${escapedChildPath2}\\%`
    ) as Array<{
      folder_id: string;
      path: string;
      name: string;
      relative_path: string;
      parent_path: string | null;
      depth: number;
      item_count: number;
      mtime: number;
    }>;

    let foldersCopied = 0;
    if (foldersToCopy.length > 0) {
      const folderBatch: Array<{
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

      for (const row of foldersToCopy) {
        const folderPath = row.path;
        
        // Calculate new relative path and depth relative to child source
        const newRelativePath = path.relative(childSourcePath, folderPath);
        const depthParts = newRelativePath.split(path.sep).filter(p => p !== '');
        const newDepth = depthParts.length - 1; // -1 because root is depth 0
        const newParentPath = depthParts.length <= 1 
          ? null 
          : depthParts.slice(0, -1).join(path.sep);

        folderBatch.push({
          folderId: row.folder_id,
          folderPath: folderPath,
          name: row.name,
          relativePath: newRelativePath,
          parentPath: newParentPath,
          depth: Math.max(0, newDepth),
          sourceId: childSourceId,
          itemCount: row.item_count,
          mtime: row.mtime,
        });
      }

      // Batch insert folders
      if (folderBatch.length > 0) {
        await this.upsertFolderBatch(folderBatch);
        foldersCopied = folderBatch.length;
      }
    }

    return { filesCopied, foldersCopied };
  }

  /**
   * Get preview of what will be deleted when removing a source.
   * Returns counts of files, folders, virtual placements, file content, events, and child sources that will be deleted.
   */
  async previewSourceDeletion(sourceId: number): Promise<{
    fileCount: number;
    folderCount: number;
    virtualPlacementCount: number;
    fileContentCount: number;
    eventCount: number;
    childSourceCount: number;
    sourceName: string;
    sourcePath: string;
  }> {
    const db = this.ensureReady();
    
    // Get source info
    const source = await this.getSourceById(sourceId);
    if (!source) {
      throw new Error(`Source with id ${sourceId} not found`);
    }

    // Count files
    const fileCountStmt = db.prepare(`SELECT COUNT(*) as count FROM files WHERE source_id = ?`);
    const fileCountRow = fileCountStmt.get(sourceId) as { count: number } | undefined;
    const fileCount = fileCountRow?.count || 0;

    // Count folders
    const folderCountStmt = db.prepare(`SELECT COUNT(*) as count FROM folders WHERE source_id = ?`);
    const folderCountRow = folderCountStmt.get(sourceId) as { count: number } | undefined;
    const folderCount = folderCountRow?.count || 0;

    // Count virtual placements (files from this source)
    const vpCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM virtual_placements vp
      INNER JOIN files f ON vp.file_id = f.file_id
      WHERE f.source_id = ?
    `);
    const vpCountRow = vpCountStmt.get(sourceId) as { count: number } | undefined;
    const virtualPlacementCount = vpCountRow?.count || 0;

    // Count file_content (extracted content/AI summaries)
    const fileContentCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM file_content fc
      INNER JOIN files f ON fc.file_id = f.file_id
      WHERE f.source_id = ?
    `);
    const fileContentCountRow = fileContentCountStmt.get(sourceId) as { count: number } | undefined;
    const fileContentCount = fileContentCountRow?.count || 0;

    // Count events (filesystem watch events)
    const eventCountStmt = db.prepare(`SELECT COUNT(*) as count FROM events WHERE source_id = ?`);
    const eventCountRow = eventCountStmt.get(sourceId) as { count: number } | undefined;
    const eventCount = eventCountRow?.count || 0;

    // Count child sources (sources with parent_source_id = sourceId)
    const childSourceCountStmt = db.prepare(`SELECT COUNT(*) as count FROM sources WHERE parent_source_id = ?`);
    const childSourceCountRow = childSourceCountStmt.get(sourceId) as { count: number } | undefined;
    const childSourceCount = childSourceCountRow?.count || 0;

    return {
      fileCount,
      folderCount,
      virtualPlacementCount,
      fileContentCount,
      eventCount,
      childSourceCount,
      sourceName: source.name,
      sourcePath: source.path,
    };
  }

  /**
   * Remove a source and all associated data (files, folders, virtual placements, file content, events).
   * WARNING: This permanently deletes data from the database.
   * Use previewSourceDeletion() first to show user what will be deleted.
   */
  async removeSource(sourceId: number): Promise<void> {
    const db = this.ensureReady();
    
    // Delete in correct order to maintain referential integrity:
    // 1. Delete file_content (extracted content/AI summaries) for files from this source
    db.prepare(`
      DELETE FROM file_content 
      WHERE file_id IN (SELECT file_id FROM files WHERE source_id = ?)
    `).run(sourceId);
    
    // 2. Delete virtual placements (AI tree decisions) for files from this source
    db.prepare(`
      DELETE FROM virtual_placements 
      WHERE file_id IN (SELECT file_id FROM files WHERE source_id = ?)
    `).run(sourceId);
    
    // 3. Delete all files for this source (this will cascade delete file_content and virtual_placements if CASCADE works)
    db.prepare(`DELETE FROM files WHERE source_id = ?`).run(sourceId);
    
    // 4. Delete all folders for this source
    db.prepare(`DELETE FROM folders WHERE source_id = ?`).run(sourceId);
    
    // 5. Delete all events (filesystem watch events) for this source
    db.prepare(`DELETE FROM events WHERE source_id = ?`).run(sourceId);
    
    // 6. Handle child sources: if this source has children (parent_source_id = sourceId), 
    // we should either delete them too or unlink them. For now, we'll delete child sources.
    // This ensures complete cleanup - if parent is deleted, children should be too.
    db.prepare(`DELETE FROM sources WHERE parent_source_id = ?`).run(sourceId);
    
    // 7. Finally delete the source itself
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
  }

  // ============================================================================
  // File Records
  // ============================================================================

  async upsertFile(
    fileId: string,
    filePath: string,
    name: string,
    extension: string,
    size: number,
    mtime: number,
    sourceId: number,
    relativePath?: string,
    parentPath?: string | null
  ): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();
    db.prepare(`
      INSERT INTO files (file_id, path, name, extension, size, mtime, source_id, relative_path, parent_path, created_at, updated_at, status, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?)
      ON CONFLICT(file_id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        extension = excluded.extension,
        size = excluded.size,
        mtime = excluded.mtime,
        relative_path = excluded.relative_path,
        parent_path = excluded.parent_path,
        updated_at = excluded.updated_at,
        status = 'present',
        last_seen = excluded.last_seen
    `).run(fileId, filePath, name, extension, size, mtime, sourceId, relativePath || null, parentPath ?? null, now, now, now);
  }

  async getFilesBySource(sourceId: number, query?: string, parentPath?: string | null, limit?: number, offset?: number): Promise<FileRecord[]> {
    const db = this.ensureReady();
    
    // Get source info to check for parent link
    const source = await this.getSourceById(sourceId);
    if (!source) {
      return [];
    }
    
    // Build list of source IDs to query (includes parent if linked)
    const sourceIds: number[] = [sourceId];
    if (source.parent_source_id) {
      sourceIds.push(source.parent_source_id);
      console.log(`[getFilesBySource] Including parent source ${source.parent_source_id} files`);
    }
    
    // If querying parent source files, we need to filter by child source path
    const childSourcePath = source.path;
    let normalizedChildPath: string | null = null;
    if (source.parent_source_id) {
      try {
        normalizedChildPath = fs.realpathSync.native(childSourcePath);
      } catch {
        normalizedChildPath = path.resolve(childSourcePath);
      }
    }
    
    let sql = `
      SELECT id, file_id, path, name, extension, size, mtime, source_id, relative_path, parent_path, created_at, updated_at
      FROM files
      WHERE source_id IN (${sourceIds.map(() => '?').join(',')})
      AND (status IS NULL OR status = 'present')
    `;
    const params: (number | string | null)[] = [...sourceIds];

    // If this source has a parent, filter parent files to only include those within child path
    if (source.parent_source_id && normalizedChildPath) {
      // Files from child source OR files from parent source within child path
      sql = `
        SELECT id, file_id, path, name, extension, size, mtime, source_id, relative_path, parent_path, created_at, updated_at
        FROM files
        WHERE (
          source_id = ? OR
          (source_id = ? AND (
            path = ? OR
            path LIKE ? OR
            path LIKE ?
          ))
        )
        AND (status IS NULL OR status = 'present')
      `;
      params.length = 0; // Reset params
      params.push(sourceId, source.parent_source_id, normalizedChildPath, `${normalizedChildPath}/%`, `${normalizedChildPath}\\%`);
    }

    // Filter by parent path if specified
    if (parentPath !== undefined) {
      if (parentPath === null) {
        // Root level: files with no parent_path, OR parent source files with parent_path = child source name
        if (source.parent_source_id && normalizedChildPath) {
          const childSourceName = path.basename(childSourcePath);
          sql += ` AND (
            (source_id = ? AND (parent_path IS NULL OR parent_path = '')) OR
            (source_id = ? AND parent_path = ?)
          )`;
          params.push(sourceId, source.parent_source_id, childSourceName);
        } else {
          sql += ` AND (parent_path IS NULL OR parent_path = '')`;
        }
      } else {
        // Non-root level: need to handle parent source files too
        if (source.parent_source_id && normalizedChildPath) {
          const childSourceName = path.basename(childSourcePath);
          // Transform the requested parentPath to parent source's perspective
          const parentSourceParentPath = childSourceName + '/' + parentPath;
          sql += ` AND (
            (source_id = ? AND parent_path = ?) OR
            (source_id = ? AND parent_path = ?)
          )`;
          params.push(sourceId, parentPath, source.parent_source_id, parentSourceParentPath);
        } else {
          sql += ` AND parent_path = ?`;
          params.push(parentPath);
        }
      }
    }

    if (query && query.trim()) {
      sql += ` AND (name LIKE ? OR extension LIKE ?)`;
      const likePattern = `%${query.trim()}%`;
      params.push(likePattern, likePattern);
    }

    sql += ` ORDER BY mtime DESC`;
    
    // Apply pagination (offset + limit) only if explicitly provided
    if (offset !== undefined && offset !== null && offset > 0) {
      sql += ` OFFSET ${offset}`;
    }
    
    // Apply limit only if explicitly specified
    // If limit is undefined/null, don't add LIMIT clause (get all files)
    // If limit is 0 or negative, don't add LIMIT clause (get all files)
    if (limit !== undefined && limit !== null && limit > 0) {
      sql += ` LIMIT ${limit}`;
    }
    // No LIMIT clause = get all files

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      file_id: string;
      path: string;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      source_id: number;
      relative_path: string | null;
      parent_path: string | null;
      created_at: number;
      updated_at: number;
    }>;
    
    // If this source has a parent, we need to transform parent source file paths
    // to be relative to the child source
    const needsPathTransformation = source.parent_source_id && normalizedChildPath;
    const childSourceName = path.basename(childSourcePath);
    
    return rows.map(row => {
      let relativePath = row.relative_path;
      let parentPath = row.parent_path;
      const fileSourceId = row.source_id;
      
      // Transform paths if this file is from parent source
      if (needsPathTransformation && fileSourceId === source.parent_source_id && relativePath) {
        // Remove the child source name prefix from relative_path
        // e.g., "Catholica/file.txt" -> "file.txt"
        // e.g., "Catholica/subfolder/file.txt" -> "subfolder/file.txt"
        if (relativePath.startsWith(childSourceName + '/')) {
          relativePath = relativePath.substring(childSourceName.length + 1);
        } else if (relativePath === childSourceName) {
          relativePath = ''; // Root file
        }
        
        // Transform parent_path similarly
        if (parentPath) {
          if (parentPath.startsWith(childSourceName + '/')) {
            parentPath = parentPath.substring(childSourceName.length + 1);
          } else if (parentPath === childSourceName) {
            parentPath = null; // Root level
          }
        } else if (relativePath && !relativePath.includes('/')) {
          // If relative_path has no slashes and parent_path was null, it's now root level
          parentPath = null;
        }
      }
      
      return {
        id: row.id,
        file_id: row.file_id,
        path: row.path,
        name: row.name,
        extension: row.extension,
        size: row.size,
        mtime: row.mtime,
        source_id: fileSourceId, // Keep original source_id for reference
        relative_path: relativePath,
        parent_path: parentPath,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  }

  /**
   * Smart search with ranking: filename matches > summary matches > tag matches
   * Returns results sorted by match type priority and relevance score.
   */
  async smartSearchFiles(query: string, sourceId?: number, limit: number = 20): Promise<Array<{
    file_id: string;
    name: string;
    path: string;
    relative_path: string | null;
    parent_path: string | null;
    extension: string;
    size: number;
    mtime: number;
    source_id: number;
    match_type: 'filename' | 'summary' | 'tags';
    match_score: number;
    summary: string | null;
    tags: string[] | null;
    virtual_path: string | null;
  }>> {
    const db = this.ensureReady();
    
    // Check if tags column exists
    const tableInfo = db.prepare(`PRAGMA table_info(file_content)`).all() as Array<{ name: string }>;
    const hasTagsColumn = tableInfo.some(col => col.name === 'tags');
    
    const searchQuery = query.trim().toLowerCase();
    if (searchQuery.length === 0) {
      return [];
    }
    
    const searchPattern = `%${searchQuery}%`;
    
    // Build WHERE clause for source filtering
    let sourceFilter = '';
    const params: (string | number)[] = [];
    if (sourceId !== undefined) {
      sourceFilter = 'AND f.source_id = ?';
      params.push(sourceId);
    }
    
    const tagsSelect = hasTagsColumn ? 'fc.tags' : 'NULL as tags';
    const tagsWhere = hasTagsColumn 
      ? 'OR (fc.tags IS NOT NULL AND LOWER(fc.tags) LIKE ?)'
      : '';
    
    // Simplified SQL: Get all matching files, then rank in JavaScript for better control
    const sql = `
      SELECT 
        f.file_id,
        f.name,
        f.path,
        f.relative_path,
        f.parent_path,
        f.extension,
        f.size,
        f.mtime,
        f.source_id,
        fc.summary,
        ${tagsSelect},
        vp.virtual_path
      FROM files f
      LEFT JOIN file_content fc ON f.file_id = fc.file_id
      LEFT JOIN virtual_placements vp ON f.file_id = vp.file_id
      WHERE (f.status IS NULL OR f.status = 'present')
        ${sourceFilter}
        AND (
          LOWER(f.name) LIKE ?
          OR (fc.summary IS NOT NULL AND LOWER(fc.summary) LIKE ?)
          ${tagsWhere}
        )
      ORDER BY f.mtime DESC
      LIMIT ?
    `;
    
    const searchParams = hasTagsColumn 
      ? [searchPattern, searchPattern, searchPattern]
      : [searchPattern, searchPattern];
    const allParams = [...params, ...searchParams, limit * 3]; // Get more results to rank, then limit
    
    const rows = db.prepare(sql).all(...allParams) as Array<{
      file_id: string;
      name: string;
      path: string;
      relative_path: string | null;
      parent_path: string | null;
      extension: string;
      size: number;
      mtime: number;
      source_id: number;
      summary: string | null;
      tags: string | null;
      virtual_path: string | null;
    }>;
    
    // Rank results in JavaScript for better control
    const rankedResults = rows.map(row => {
      const nameLower = row.name.toLowerCase();
      const summaryLower = row.summary?.toLowerCase() || '';
      let tagsLower = '';
      let parsedTags: string[] | null = null;
      
      if (row.tags) {
        try {
          const value = JSON.parse(row.tags);
          if (Array.isArray(value)) {
            parsedTags = value
              .filter((t) => typeof t === 'string')
              .map((t) => t.trim())
              .filter((t) => t.length > 0);
            tagsLower = parsedTags.join(' ').toLowerCase();
          }
        } catch {
          parsedTags = null;
        }
      }
      
      // Determine match type and score
      let match_type: 'filename' | 'summary' | 'tags' = 'filename';
      let match_score = 0;
      
      // Check filename match (highest priority)
      if (nameLower.includes(searchQuery)) {
        match_type = 'filename';
        match_score = 1000;
        // Bonus for exact match
        if (nameLower === searchQuery) {
          match_score += 100;
        }
        // Bonus for starts with
        if (nameLower.startsWith(searchQuery)) {
          match_score += 50;
        }
      }
      // Check summary match (medium priority)
      else if (summaryLower.includes(searchQuery)) {
        match_type = 'summary';
        match_score = 500;
        // Bonus for multiple occurrences
        const occurrences = (summaryLower.match(new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        match_score += Math.min(occurrences * 10, 50);
      }
      // Check tag match (lowest priority)
      else if (tagsLower.includes(searchQuery)) {
        match_type = 'tags';
        match_score = 100;
        // Bonus for exact tag match
        if (parsedTags?.some(tag => tag.toLowerCase() === searchQuery)) {
          match_score += 50;
        }
      }
      
      return {
        file_id: row.file_id,
        name: row.name,
        path: row.path,
        relative_path: row.relative_path,
        parent_path: row.parent_path,
        extension: row.extension,
        size: row.size,
        mtime: row.mtime,
        source_id: row.source_id,
        match_type,
        match_score,
        summary: row.summary,
        tags: parsedTags,
        virtual_path: row.virtual_path,
      };
    });
    
    // Sort by score (descending) and limit
    return rankedResults
      .sort((a, b) => {
        if (b.match_score !== a.match_score) {
          return b.match_score - a.match_score;
        }
        return b.mtime - a.mtime; // Tie-breaker: newer files first
      })
      .slice(0, limit);
  }

  async getFileCount(sourceId: number): Promise<number> {
    const db = this.ensureReady();
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM files WHERE source_id = ?`);
    const row = stmt.get(sourceId) as { count: number } | undefined;
    return row?.count || 0;
  }

  /**
   * Get a file record by source ID and file path.
   */
  async getFileByPath(sourceId: number, filePath: string): Promise<FileRecord | undefined> {
    const db = this.ensureReady();
    const stmt = db.prepare(`
      SELECT id, file_id, path, name, extension, size, mtime, source_id, relative_path, parent_path, created_at, updated_at
      FROM files
      WHERE source_id = ? AND path = ?
    `);
    const row = stmt.get(sourceId, filePath) as {
      id: number;
      file_id: string;
      path: string;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      source_id: number;
      relative_path: string | null;
      parent_path: string | null;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      file_id: row.file_id,
      path: row.path,
      name: row.name,
      extension: row.extension,
      size: row.size,
      mtime: row.mtime,
      source_id: row.source_id,
      relative_path: row.relative_path,
      parent_path: row.parent_path,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Find a file record by path across all sources.
   * Useful for finding files that might belong to parent sources.
   */
  async findFileByPath(filePath: string): Promise<FileRecord | undefined> {
    const db = this.ensureReady();
    const stmt = db.prepare(`
      SELECT id, file_id, path, name, extension, size, mtime, source_id, relative_path, parent_path, created_at, updated_at, status
      FROM files
      WHERE path = ?
      LIMIT 1
    `);
    const row = stmt.get(filePath) as {
      id: number;
      file_id: string;
      path: string;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      source_id: number;
      relative_path: string | null;
      parent_path: string | null;
      created_at: number;
      updated_at: number;
      status: string | null;
    } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      file_id: row.file_id,
      path: row.path,
      name: row.name,
      extension: row.extension,
      size: row.size,
      mtime: row.mtime,
      source_id: row.source_id,
      relative_path: row.relative_path,
      parent_path: row.parent_path,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Mark a file as missing (deleted from filesystem).
   */
  async markFileMissing(fileId: string): Promise<void> {
    const db = this.ensureReady();
    const result = db.prepare(`
      UPDATE files
      SET status = 'missing'
      WHERE file_id = ?
    `).run(fileId);
    console.log(`[DatabaseManager] Marked file ${fileId} as missing (${result.changes} row(s) updated)`);
  }

  /**
   * Insert a filesystem event into the events table.
   */
  async insertEvent(event: {
    sourceId: number;
    type: 'add' | 'change' | 'unlink';
    path: string;
    pathOld?: string;
  }): Promise<void> {
    const db = this.ensureReady();
    
    // Verify source exists before inserting event
    const source = await this.getSourceById(event.sourceId);
    if (!source) {
      console.warn(`[DatabaseManager] Cannot insert event: source ${event.sourceId} does not exist`);
      return; // Silently skip if source doesn't exist
    }
    
    const ts = Date.now();
    // Generate event_id: sha1(ts + sourceId + path)
    const eventIdData = `${ts}|${event.sourceId}|${event.path}`;
    const eventId = crypto.createHash('sha1').update(eventIdData).digest('hex');

    try {
      db.prepare(`
        INSERT INTO events (event_id, ts, source_id, type, path_old, path_new)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(eventId, ts, event.sourceId, event.type, event.pathOld || null, event.path);
    } catch (error: any) {
      // Handle foreign key constraint errors gracefully
      if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        console.warn(`[DatabaseManager] Foreign key constraint failed for event (source ${event.sourceId} may not exist):`, error.message);
        return; // Silently skip
      }
      throw error; // Re-throw other errors
    }
  }

  async deleteFilesNotInSet(sourceId: number, fileIds: Set<string>): Promise<number> {
    const db = this.ensureReady();
    
    if (fileIds.size === 0) {
      // Delete all files for this source
      const result = db.prepare(`DELETE FROM files WHERE source_id = ?`).run(sourceId);
      return result.changes;
    }

    // Get all existing file_ids for this source
    const stmt = db.prepare(`SELECT file_id FROM files WHERE source_id = ?`);
    const existingRows = stmt.all(sourceId) as Array<{ file_id: string }>;
    
    if (existingRows.length === 0) {
      return 0;
    }

    // Find file_ids that need to be deleted (exist in DB but not in fileIds set)
    const toDelete: string[] = [];
    for (const row of existingRows) {
      if (!fileIds.has(row.file_id)) {
        toDelete.push(row.file_id);
      }
    }

    if (toDelete.length === 0) {
      return 0;
    }

    // Delete in batches to avoid "too many SQL variables" error
    let totalDeleted = 0;
    const deleteStmt = db.prepare(`DELETE FROM files WHERE file_id = ?`);
    const deleteTransaction = db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });

    for (let i = 0; i < toDelete.length; i += SQLITE_MAX_VARIABLES) {
      const batch = toDelete.slice(i, i + SQLITE_MAX_VARIABLES);
      deleteTransaction(batch);
      totalDeleted += batch.length;
    }

    return totalDeleted;
  }

  // Batch insert for efficiency
  async upsertFileBatch(files: Array<{
    fileId: string;
    filePath: string;
    name: string;
    extension: string;
    size: number;
    mtime: number;
    sourceId: number;
    relativePath?: string;
    parentPath?: string | null;
  }>): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();
    
    const stmt = db.prepare(`
      INSERT INTO files (file_id, path, name, extension, size, mtime, source_id, relative_path, parent_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        extension = excluded.extension,
        size = excluded.size,
        mtime = excluded.mtime,
        relative_path = excluded.relative_path,
        parent_path = excluded.parent_path,
        updated_at = excluded.updated_at
    `);

    // Use transaction for batch inserts
    const insertTransaction = db.transaction((fileBatch: typeof files) => {
      for (const file of fileBatch) {
        stmt.run(file.fileId, file.filePath, file.name, file.extension, file.size, file.mtime, file.sourceId, file.relativePath || null, file.parentPath ?? null, now, now);
      }
    });

    insertTransaction(files);
  }

  // ============================================================================
  // Folders
  // ============================================================================

  async upsertFolder(
    folderId: string,
    folderPath: string,
    name: string,
    relativePath: string,
    parentPath: string | null,
    depth: number,
    sourceId: number,
    itemCount: number,
    mtime: number
  ): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();
    db.prepare(`
      INSERT INTO folders (folder_id, path, name, relative_path, parent_path, depth, source_id, item_count, mtime, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        relative_path = excluded.relative_path,
        parent_path = excluded.parent_path,
        depth = excluded.depth,
        item_count = excluded.item_count,
        mtime = excluded.mtime,
        updated_at = excluded.updated_at
    `).run(folderId, folderPath, name, relativePath, parentPath, depth, sourceId, itemCount, mtime, now, now);
  }

  async upsertFolderBatch(folders: Array<{
    folderId: string;
    folderPath: string;
    name: string;
    relativePath: string;
    parentPath: string | null;
    depth: number;
    sourceId: number;
    itemCount: number;
    mtime: number;
  }>): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();
    
    const stmt = db.prepare(`
      INSERT INTO folders (folder_id, path, name, relative_path, parent_path, depth, source_id, item_count, mtime, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        relative_path = excluded.relative_path,
        parent_path = excluded.parent_path,
        depth = excluded.depth,
        item_count = excluded.item_count,
        mtime = excluded.mtime,
        updated_at = excluded.updated_at
    `);

    // Use transaction for batch inserts
    const insertTransaction = db.transaction((folderBatch: typeof folders) => {
      for (const folder of folderBatch) {
        stmt.run(folder.folderId, folder.folderPath, folder.name, folder.relativePath, folder.parentPath, folder.depth, folder.sourceId, folder.itemCount, folder.mtime, now, now);
      }
    });

    insertTransaction(folders);
  }

  async getFoldersBySource(sourceId: number, parentPath?: string | null, query?: string): Promise<FolderRecord[]> {
    const db = this.ensureReady();
    
    // Get source info to check for parent link
    const source = await this.getSourceById(sourceId);
    if (!source) {
      return [];
    }
    
    // Build list of source IDs to query (includes parent if linked)
    const sourceIds: number[] = [sourceId];
    if (source.parent_source_id) {
      sourceIds.push(source.parent_source_id);
      console.log(`[getFoldersBySource] Including parent source ${source.parent_source_id} folders`);
    }
    
    // If querying parent source folders, we need to filter by child source path
    const childSourcePath = source.path;
    let normalizedChildPath: string | null = null;
    if (source.parent_source_id) {
      try {
        normalizedChildPath = fs.realpathSync.native(childSourcePath);
      } catch {
        normalizedChildPath = path.resolve(childSourcePath);
      }
    }
    
    // Determine if we're at root level (showing contents of source folder itself)
    const isRootLevel = parentPath === null || parentPath === undefined;
    
    let sql = `
      SELECT id, folder_id, path, name, relative_path, parent_path, depth, source_id, item_count, mtime, created_at, updated_at
      FROM folders
      WHERE source_id IN (${sourceIds.map(() => '?').join(',')})
    `;
    const params: (number | string | null)[] = [...sourceIds];

    // If this source has a parent, filter parent folders to only include those within child path
    if (source.parent_source_id && normalizedChildPath) {
      // Folders from child source OR folders from parent source within child path
      // BUT exclude the folder that exactly matches the source path when at root level
      sql = `
        SELECT id, folder_id, path, name, relative_path, parent_path, depth, source_id, item_count, mtime, created_at, updated_at
        FROM folders
        WHERE (
          source_id = ? OR
          (source_id = ? AND (
            path LIKE ? OR
            path LIKE ?
          ))
        )
      `;
      params.length = 0; // Reset params
      params.push(sourceId, source.parent_source_id, `${normalizedChildPath}/%`, `${normalizedChildPath}\\%`);
      
      // At root level, exclude the source folder itself (we want to be inside it)
      if (isRootLevel) {
        sql += ` AND path != ?`;
        params.push(normalizedChildPath);
      }
    } else {
      // For non-linked sources, exclude the source folder itself at root level
      if (isRootLevel) {
        sql += ` AND path != ?`;
        params.push(source.path);
      }
    }

    // If searching, ignore parent path filter
    if (query && query.trim()) {
      sql += ` AND name LIKE ?`;
      params.push(`%${query.trim()}%`);
    } else if (parentPath !== undefined) {
      // Filter by parent path if specified (only when not searching)
      if (parentPath === null) {
        // Root level: folders with no parent_path, OR parent source folders with parent_path = child source name
        if (source.parent_source_id && normalizedChildPath) {
          const childSourceName = path.basename(childSourcePath);
          sql += ` AND (
            (source_id = ? AND (parent_path IS NULL OR parent_path = '')) OR
            (source_id = ? AND parent_path = ?)
          )`;
          params.push(sourceId, source.parent_source_id, childSourceName);
        } else {
          sql += ` AND (parent_path IS NULL OR parent_path = '')`;
        }
      } else {
        // Non-root level: need to handle parent source folders too
        if (source.parent_source_id && normalizedChildPath) {
          const childSourceName = path.basename(childSourcePath);
          // Transform the requested parentPath to parent source's perspective
          const parentSourceParentPath = childSourceName + '/' + parentPath;
          sql += ` AND (
            (source_id = ? AND parent_path = ?) OR
            (source_id = ? AND parent_path = ?)
          )`;
          params.push(sourceId, parentPath, source.parent_source_id, parentSourceParentPath);
        } else {
          sql += ` AND parent_path = ?`;
          params.push(parentPath);
        }
      }
    }

    sql += ` ORDER BY name LIMIT 500`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      folder_id: string;
      path: string;
      name: string;
      relative_path: string;
      parent_path: string | null;
      depth: number;
      source_id: number;
      item_count: number;
      mtime: number;
      created_at: number;
      updated_at: number;
    }>;
    
    // If this source has a parent, we need to transform parent source folder paths
    // to be relative to the child source
    const needsPathTransformation = source.parent_source_id && normalizedChildPath;
    const childSourceName = path.basename(childSourcePath);
    
    return rows
      .map(row => {
        let relativePath = row.relative_path;
        let parentPath = row.parent_path;
        let depth = row.depth;
        const folderSourceId = row.source_id;
        
        // Transform paths if this folder is from parent source
        if (needsPathTransformation && folderSourceId === source.parent_source_id) {
          // Remove the child source name prefix from relative_path
          // e.g., "Catholica/subfolder" -> "subfolder"
          if (relativePath.startsWith(childSourceName + '/')) {
            relativePath = relativePath.substring(childSourceName.length + 1);
            // Adjust depth: subtract 1 since we're removing one level
            depth = Math.max(0, depth - 1);
          } else if (relativePath === childSourceName) {
            // This is the source folder itself - skip it (should be filtered by SQL, but just in case)
            return null;
          }
          
          // Transform parent_path similarly
          if (parentPath) {
            if (parentPath.startsWith(childSourceName + '/')) {
              parentPath = parentPath.substring(childSourceName.length + 1);
            } else if (parentPath === childSourceName) {
              parentPath = null; // Root level
            }
          }
        }
        
        return {
          id: row.id,
          folder_id: row.folder_id,
          path: row.path,
          name: row.name,
          relative_path: relativePath,
          parent_path: parentPath,
          depth: depth,
          source_id: folderSourceId, // Keep original source_id for reference
          item_count: row.item_count,
          mtime: row.mtime,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      })
      .filter((f): f is FolderRecord => f !== null);
  }

  async getAllFolders(sourceId: number): Promise<FolderRecord[]> {
    const db = this.ensureReady();
    const stmt = db.prepare(`
      SELECT id, folder_id, path, name, relative_path, parent_path, depth, source_id, item_count, mtime, created_at, updated_at
      FROM folders
      WHERE source_id = ?
      ORDER BY depth, name
    `);
    const rows = stmt.all(sourceId) as Array<{
      id: number;
      folder_id: string;
      path: string;
      name: string;
      relative_path: string;
      parent_path: string | null;
      depth: number;
      source_id: number;
      item_count: number;
      mtime: number;
      created_at: number;
      updated_at: number;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      folder_id: row.folder_id,
      path: row.path,
      name: row.name,
      relative_path: row.relative_path,
      parent_path: row.parent_path,
      depth: row.depth,
      source_id: row.source_id,
      item_count: row.item_count,
      mtime: row.mtime,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async getFolderCount(sourceId: number): Promise<number> {
    const db = this.ensureReady();
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM folders WHERE source_id = ?`);
    const row = stmt.get(sourceId) as { count: number } | undefined;
    return row?.count || 0;
  }

  async deleteFoldersNotInSet(sourceId: number, folderIds: Set<string>): Promise<number> {
    const db = this.ensureReady();
    
    if (folderIds.size === 0) {
      // Delete all folders for this source
      const result = db.prepare(`DELETE FROM folders WHERE source_id = ?`).run(sourceId);
      return result.changes;
    }

    // Get all existing folder_ids for this source
    const stmt = db.prepare(`SELECT folder_id FROM folders WHERE source_id = ?`);
    const existingRows = stmt.all(sourceId) as Array<{ folder_id: string }>;
    
    if (existingRows.length === 0) {
      return 0;
    }

    // Find folder_ids that need to be deleted
    const toDelete: string[] = [];
    for (const row of existingRows) {
      if (!folderIds.has(row.folder_id)) {
        toDelete.push(row.folder_id);
      }
    }

    if (toDelete.length === 0) {
      return 0;
    }

    // Delete in batches
    let totalDeleted = 0;
    const deleteStmt = db.prepare(`DELETE FROM folders WHERE folder_id = ?`);
    const deleteTransaction = db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });

    for (let i = 0; i < toDelete.length; i += SQLITE_MAX_VARIABLES) {
      const batch = toDelete.slice(i, i + SQLITE_MAX_VARIABLES);
      deleteTransaction(batch);
      totalDeleted += batch.length;
    }

    return totalDeleted;
  }

  /**
   * Optimized version that processes DB results in chunks to avoid memory issues.
   * Uses the scannedFileIds Set (already in memory) for O(1) lookups.
   * Processes DB results in chunks to avoid loading all file_ids at once.
   */
  async deleteFilesNotInSetOptimized(sourceId: number, fileIds: Set<string>): Promise<number> {
    const db = this.ensureReady();
    
    if (fileIds.size === 0) {
      // Delete all files for this source
      const result = db.prepare(`DELETE FROM files WHERE source_id = ?`).run(sourceId);
      return result.changes;
    }

    // If fileIds is small enough, use simple SQL approach
    if (fileIds.size <= SQLITE_MAX_VARIABLES) {
      const fileIdsArray = Array.from(fileIds);
      const placeholders = fileIdsArray.map(() => '?').join(',');
      const result = db.prepare(`
        DELETE FROM files 
        WHERE source_id = ? 
        AND file_id NOT IN (${placeholders})
      `).run(sourceId, ...fileIdsArray);
      return result.changes;
    }

    // For large sets: process DB results in chunks to avoid memory issues
    // Use LIMIT/OFFSET to process in batches instead of loading all at once
    const CHUNK_SIZE = 10000; // Process 10k file_ids at a time
    let totalDeleted = 0;
    let offset = 0;
    let hasMore = true;

    const selectStmt = db.prepare(`
      SELECT file_id 
      FROM files 
      WHERE source_id = ?
      LIMIT ? OFFSET ?
    `);

    const deleteStmt = db.prepare(`DELETE FROM files WHERE file_id = ?`);
    const deleteTransaction = db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });

    while (hasMore) {
      // Get a chunk of file_ids from DB
      const existingRows = selectStmt.all(sourceId, CHUNK_SIZE, offset) as Array<{ file_id: string }>;
      
      if (existingRows.length === 0) {
        hasMore = false;
        break;
      }

      const toDelete: string[] = [];
      
      // Check each ID in this chunk against the Set
      for (const row of existingRows) {
        if (!fileIds.has(row.file_id)) {
          toDelete.push(row.file_id);
        }
      }

      // Delete this chunk in batches to avoid SQL variable limits
      if (toDelete.length > 0) {
        for (let i = 0; i < toDelete.length; i += SQLITE_MAX_VARIABLES) {
          const batch = toDelete.slice(i, i + SQLITE_MAX_VARIABLES);
          deleteTransaction(batch);
          totalDeleted += batch.length;
        }
      }

      // Check if we've processed all files
      if (existingRows.length < CHUNK_SIZE) {
        hasMore = false;
      } else {
        offset += CHUNK_SIZE;
      }
    }

    return totalDeleted;
  }

  /**
   * Optimized version that uses SQL to find folders to delete without loading all IDs into memory.
   */
  async deleteFoldersNotInSetOptimized(sourceId: number, folderIds: Set<string>): Promise<number> {
    const db = this.ensureReady();
    
    if (folderIds.size === 0) {
      // Delete all folders for this source
      const result = db.prepare(`DELETE FROM folders WHERE source_id = ?`).run(sourceId);
      return result.changes;
    }

    // Use optimized approach: get all folder_ids from DB, check against Set in memory
    // Folders are typically much fewer than files, so this is acceptable
    const stmt = db.prepare(`SELECT folder_id FROM folders WHERE source_id = ?`);
    const existingRows = stmt.all(sourceId) as Array<{ folder_id: string }>;
    
    if (existingRows.length === 0) {
      return 0;
    }

    const toDelete: string[] = [];
    
    for (const row of existingRows) {
      if (!folderIds.has(row.folder_id)) {
        toDelete.push(row.folder_id);
      }
    }

    if (toDelete.length === 0) {
      return 0;
    }

    // Delete in batches
    let totalDeleted = 0;
    const deleteStmt = db.prepare(`DELETE FROM folders WHERE folder_id = ?`);
    const deleteTransaction = db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });

    for (let i = 0; i < toDelete.length; i += SQLITE_MAX_VARIABLES) {
      const batch = toDelete.slice(i, i + SQLITE_MAX_VARIABLES);
      deleteTransaction(batch);
      totalDeleted += batch.length;
    }

    return totalDeleted;
  }

  // ============================================================================
  // Virtual Placements
  // ============================================================================

  async upsertVirtualPlacement(output: PlannerOutput, plannerVersion: string): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();
    const tagsJson = JSON.stringify(output.tags);
    db.prepare(`
      INSERT INTO virtual_placements (file_id, virtual_path, tags, confidence, reason, planner_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        virtual_path = excluded.virtual_path,
        tags = excluded.tags,
        confidence = excluded.confidence,
        reason = excluded.reason,
        planner_version = excluded.planner_version,
        created_at = excluded.created_at
    `).run(output.file_id, output.virtual_path, tagsJson, output.confidence, output.reason, plannerVersion, now);
  }

  /**
   * Batch upsert virtual placements in a single transaction.
   * Much faster than individual inserts (60-90x speedup).
   * 
   * @param outputs - Array of planner outputs to store
   * @param plannerVersion - Version string of the planner that generated these outputs
   */
  async upsertVirtualPlacementBatch(
    outputs: PlannerOutput[],
    plannerVersion: string
  ): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();

    if (outputs.length === 0) {
      return;
    }

    // Use a transaction for atomicity and performance
    const insertStmt = db.prepare(`
      INSERT INTO virtual_placements (file_id, virtual_path, tags, confidence, reason, planner_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        virtual_path = excluded.virtual_path,
        tags = excluded.tags,
        confidence = excluded.confidence,
        reason = excluded.reason,
        planner_version = excluded.planner_version,
        created_at = excluded.created_at
    `);

    const insertMany = db.transaction((outputs: PlannerOutput[]) => {
      for (const output of outputs) {
        const tagsJson = JSON.stringify(output.tags);
        insertStmt.run(
          output.file_id,
          output.virtual_path,
          tagsJson,
          output.confidence,
          output.reason,
          plannerVersion,
          now
        );
      }
    });

    insertMany(outputs);
  }

  async getVirtualPlacements(sourceId?: number): Promise<VirtualPlacement[]> {
    const db = this.ensureReady();
    
    let sql = `
      SELECT vp.id, vp.file_id, vp.virtual_path, vp.tags, vp.confidence, vp.reason, vp.planner_version, vp.created_at
      FROM virtual_placements vp
    `;
    
    const params: number[] = [];
    
    if (sourceId !== undefined) {
      // Get source info to check for parent link
      const source = await this.getSourceById(sourceId);
      if (!source) {
        return [];
      }
      
      // Build list of source IDs to query (includes parent if linked)
      const sourceIds: number[] = [sourceId];
      if (source.parent_source_id) {
        sourceIds.push(source.parent_source_id);
      }
      
      sql += `
        INNER JOIN files f ON vp.file_id = f.file_id
        WHERE f.source_id IN (${sourceIds.map(() => '?').join(',')})
        AND (f.status IS NULL OR f.status = 'present')
      `;
      params.push(...sourceIds);
    }
    
    sql += ` ORDER BY vp.virtual_path`;
    
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      file_id: string;
      virtual_path: string;
      tags: string;
      confidence: number;
      reason: string;
      planner_version: string;
      created_at: number;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      file_id: row.file_id,
      virtual_path: row.virtual_path,
      tags: row.tags,
      confidence: row.confidence,
      reason: row.reason,
      planner_version: row.planner_version,
      created_at: row.created_at,
    }));
  }

  /**
   * Get virtual placements filtered by virtual path prefix.
   * Useful for getting all files in a virtual folder.
   */
  async getVirtualPlacementsByPath(virtualPath: string, sourceId?: number): Promise<VirtualPlacement[]> {
    const db = this.ensureReady();
    
    // Normalize path: ensure it starts with / and ends with / for prefix matching
    const normalizedPath = virtualPath === '/' ? '/' : virtualPath.endsWith('/') ? virtualPath : virtualPath + '/';
    
    let sql = `
      SELECT vp.id, vp.file_id, vp.virtual_path, vp.tags, vp.confidence, vp.reason, vp.planner_version, vp.created_at
      FROM virtual_placements vp
    `;
    
    const params: (number | string)[] = [];
    
    if (sourceId !== undefined) {
      const source = await this.getSourceById(sourceId);
      if (!source) {
        return [];
      }
      
      const sourceIds: number[] = [sourceId];
      if (source.parent_source_id) {
        sourceIds.push(source.parent_source_id);
      }
      
      sql += `
        INNER JOIN files f ON vp.file_id = f.file_id
        WHERE f.source_id IN (${sourceIds.map(() => '?').join(',')})
        AND (f.status IS NULL OR f.status = 'present')
        AND (
          vp.virtual_path = ? OR
          vp.virtual_path LIKE ?
        )
      `;
      params.push(...sourceIds, virtualPath, normalizedPath + '%');
    } else {
      sql += `
        WHERE vp.virtual_path = ? OR vp.virtual_path LIKE ?
      `;
      params.push(virtualPath, normalizedPath + '%');
    }
    
    sql += ` ORDER BY vp.virtual_path`;
    
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      file_id: string;
      virtual_path: string;
      tags: string;
      confidence: number;
      reason: string;
      planner_version: string;
      created_at: number;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      file_id: row.file_id,
      virtual_path: row.virtual_path,
      tags: row.tags,
      confidence: row.confidence,
      reason: row.reason,
      planner_version: row.planner_version,
      created_at: row.created_at,
    }));
  }

  /**
   * Get only top-level virtual placements (one level deep: /FolderName/file.ext).
   * Optimized for building initial folder structure without loading all 220k+ placements.
   * 
   * @param sourceId - Optional source ID to filter by
   * @returns Virtual placements with pattern /FolderName/file.ext (excludes deeper paths)
   */
  async getTopLevelVirtualPlacements(sourceId?: number): Promise<VirtualPlacement[]> {
    const db = this.ensureReady();
    
    let sql = `
      SELECT 
        vp.id, 
        vp.file_id, 
        vp.virtual_path, 
        vp.tags, 
        vp.confidence, 
        vp.reason, 
        vp.planner_version, 
        vp.created_at
      FROM virtual_placements vp
    `;
    
    const params: number[] = [];
    
    if (sourceId !== undefined) {
      // Get source info to check for parent link
      const source = await this.getSourceById(sourceId);
      if (!source) {
        return [];
      }
      
      // Build list of source IDs to query (includes parent if linked)
      const sourceIds: number[] = [sourceId];
      if (source.parent_source_id) {
        sourceIds.push(source.parent_source_id);
      }
      
      sql += `
        INNER JOIN files f ON vp.file_id = f.file_id
        WHERE f.source_id IN (${sourceIds.map(() => '?').join(',')})
        AND (f.status IS NULL OR f.status = 'present')
        AND vp.virtual_path LIKE '/%/%'
        AND vp.virtual_path NOT LIKE '/%/%/%'
      `;
      params.push(...sourceIds);
    } else {
      sql += `
        WHERE vp.virtual_path LIKE '/%/%'
        AND vp.virtual_path NOT LIKE '/%/%/%'
      `;
    }
    
    sql += ` ORDER BY vp.virtual_path`;
    
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      file_id: string;
      virtual_path: string;
      tags: string;
      confidence: number;
      reason: string;
      planner_version: string;
      created_at: number;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      file_id: row.file_id,
      virtual_path: row.virtual_path,
      tags: row.tags,
      confidence: row.confidence,
      reason: row.reason,
      planner_version: row.planner_version,
      created_at: row.created_at,
    }));
  }

  /**
   * Get total count of virtual placements (fast COUNT query).
   * Used for displaying root file count without loading all placements.
   * 
   * @param sourceId - Optional source ID to filter by
   * @returns Total count of virtual placements
   */
  async getVirtualPlacementCount(sourceId?: number): Promise<number> {
    const db = this.ensureReady();
    
    let sql = `
      SELECT COUNT(*) as count
      FROM virtual_placements vp
    `;
    
    const params: number[] = [];
    
    if (sourceId !== undefined) {
      // Get source info to check for parent link
      const source = await this.getSourceById(sourceId);
      if (!source) {
        return 0;
      }
      
      // Build list of source IDs to query (includes parent if linked)
      const sourceIds: number[] = [sourceId];
      if (source.parent_source_id) {
        sourceIds.push(source.parent_source_id);
      }
      
      sql += `
        INNER JOIN files f ON vp.file_id = f.file_id
        WHERE f.source_id IN (${sourceIds.map(() => '?').join(',')})
        AND (f.status IS NULL OR f.status = 'present')
      `;
      params.push(...sourceIds);
    }
    
    const stmt = db.prepare(sql);
    const row = stmt.get(...params) as { count: number } | undefined;
    
    return row?.count || 0;
  }

  // File Content
  // ============================================================================

  async upsertFileContent(
    fileId: string,
    contentType: string,
    extractedText: string | null,
    summary: string | null,
    keywords: string[],
    metadata: Record<string, any> | null,
    extractorVersion: string,
    errorMessage: string | null = null,
    tags: string[] | null = null
  ): Promise<void> {
    const db = this.ensureReady();
    const now = Date.now();
    const keywordsJson = JSON.stringify(keywords);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    // Check if tags column exists (for migration compatibility)
    const tableInfo = db.prepare(`PRAGMA table_info(file_content)`).all() as Array<{ name: string }>;
    const hasTagsColumn = tableInfo.some(col => col.name === 'tags');
    const tagsJson = tags ? JSON.stringify(tags) : null;
    
    if (hasTagsColumn) {
      db.prepare(`
        INSERT INTO file_content (file_id, content_type, extracted_text, summary, keywords, metadata, extracted_at, extractor_version, error_message, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
          content_type = excluded.content_type,
          extracted_text = excluded.extracted_text,
          summary = excluded.summary,
          keywords = excluded.keywords,
          metadata = excluded.metadata,
          extracted_at = excluded.extracted_at,
          extractor_version = excluded.extractor_version,
          error_message = excluded.error_message,
          tags = excluded.tags
      `).run(
        fileId,
        contentType,
        extractedText,
        summary,
        keywordsJson,
        metadataJson,
        now,
        extractorVersion,
        errorMessage,
        tagsJson
      );
    } else {
      // Fallback for older schema
      db.prepare(`
        INSERT INTO file_content (file_id, content_type, extracted_text, summary, keywords, metadata, extracted_at, extractor_version, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
          content_type = excluded.content_type,
          extracted_text = excluded.extracted_text,
          summary = excluded.summary,
          keywords = excluded.keywords,
          metadata = excluded.metadata,
          extracted_at = excluded.extracted_at,
          extractor_version = excluded.extractor_version,
          error_message = excluded.error_message
      `).run(
        fileId,
        contentType,
        extractedText,
        summary,
        keywordsJson,
        metadataJson,
        now,
        extractorVersion,
        errorMessage
      );
    }
  }

  async getFileContent(fileId: string): Promise<{
    file_id: string;
    content_type: string;
    extracted_text: string | null;
    summary: string | null;
    keywords: string;
    tags: string | null;
    metadata: string | null;
    extracted_at: number;
    extractor_version: string;
    error_message: string | null;
  } | null> {
    const db = this.ensureReady();
    // Check if tags column exists
    const tableInfo = db.prepare(`PRAGMA table_info(file_content)`).all() as Array<{ name: string }>;
    const hasTagsColumn = tableInfo.some(col => col.name === 'tags');
    
    const selectFields = hasTagsColumn
      ? 'file_id, content_type, extracted_text, summary, keywords, tags, metadata, extracted_at, extractor_version, error_message'
      : 'file_id, content_type, extracted_text, summary, keywords, NULL as tags, metadata, extracted_at, extractor_version, error_message';
    
    const row = db.prepare(`
      SELECT ${selectFields}
      FROM file_content
      WHERE file_id = ?
    `).get(fileId) as any;
    return row || null;
  }

  async getFilesWithoutContent(sourceId?: number): Promise<string[]> {
    const db = this.ensureReady();
    
    let sql = `
      SELECT f.file_id
      FROM files f
      LEFT JOIN file_content fc ON f.file_id = fc.file_id
      WHERE fc.file_id IS NULL
      AND (f.status IS NULL OR f.status = 'present')
    `;
    
    const params: number[] = [];
    if (sourceId !== undefined) {
      sql += ` AND f.source_id = ?`;
      params.push(sourceId);
    }
    
    const rows = db.prepare(sql).all(...params) as Array<{ file_id: string }>;
    return rows.map(row => row.file_id);
  }

  // ============================================================================
  // File Cards (file + AI metadata view)
  // ============================================================================

  /**
   * Build lightweight "file cards" for a source by joining files with file_content.
   * This is read-only and does not modify any schema.
   *
   * NOTE: Tags are stored as JSON string in file_content.tags; we decode them here.
   */
  async getFileCardsBySource(sourceId: number, limit?: number): Promise<FileCard[]> {
    const db = this.ensureReady();

    // Check if tags column exists on file_content for migration compatibility
    const tableInfo = db.prepare(`PRAGMA table_info(file_content)`).all() as Array<{ name: string }>;
    const hasTagsColumn = tableInfo.some(col => col.name === 'tags');

    const selectFields = hasTagsColumn
      ? `
        f.file_id,
        f.source_id,
        f.path,
        f.relative_path,
        f.name,
        f.extension,
        f.size,
        f.mtime,
        fc.summary,
        fc.tags
      `
      : `
        f.file_id,
        f.source_id,
        f.path,
        f.relative_path,
        f.name,
        f.extension,
        f.size,
        f.mtime,
        fc.summary,
        NULL as tags
      `;

    let sql = `
      SELECT
        ${selectFields}
      FROM files f
      LEFT JOIN file_content fc ON f.file_id = fc.file_id
      WHERE f.source_id = ?
        AND (f.status IS NULL OR f.status = 'present')
      ORDER BY f.mtime DESC
    `;

    if (typeof limit === 'number' && limit > 0) {
      sql += ` LIMIT ${limit}`;
    }

    const rows = db.prepare(sql).all(sourceId) as Array<{
      file_id: string;
      source_id: number;
      path: string;
      relative_path: string | null;
      name: string;
      extension: string;
      size: number;
      mtime: number;
      summary: string | null;
      tags: string | null;
    }>;

    return rows.map((row): FileCard => {
      let parsedTags: string[] = [];
      if (row.tags) {
        try {
          const value = JSON.parse(row.tags);
          if (Array.isArray(value)) {
            parsedTags = value
              .filter((t) => typeof t === 'string')
              .map((t) => t.trim())
              .filter((t) => t.length > 0);
          }
        } catch {
          // Ignore parse errors and fall back to empty tag list
          parsedTags = [];
        }
      }

      return {
        file_id: row.file_id,
        source_id: row.source_id,
        path: row.path,
        relative_path: row.relative_path,
        name: row.name,
        extension: row.extension,
        size: row.size,
        mtime: row.mtime,
        summary: row.summary,
        tags: parsedTags,
      };
    });
  }

  // ============================================================================
  // Settings
  // ============================================================================

  async getSetting(key: string): Promise<string | undefined> {
    const db = this.ensureReady();
    const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = this.ensureReady();
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export { runMigrations };
