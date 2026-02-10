import type { FileRecord, PlannerOutput, VirtualPlacement } from '../ipc/contracts';

/**
 * Represents a node in the virtual folder tree.
 */
export interface VirtualNode {
  id: string;
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: VirtualNode[];
  // Only present for file nodes
  fileRecord?: FileRecord;
  placement?: PlannerOutput;
  // Only present for folder nodes - pre-computed count of all files in subtree
  fileCount?: number;
}

/**
 * Builds a virtual folder tree from planner outputs and file records.
 * 
 * This module constructs a hierarchical tree structure that represents
 * the AI-organized view of files, separate from their actual filesystem location.
 */
export class VirtualTreeBuilder {
  /**
   * Build a virtual tree from planner outputs.
   * 
   * @param outputs - Planner outputs with virtual_path for each file
   * @param fileRecordsMap - Map of file_id to FileRecord for looking up file details
   * @returns Root VirtualNode containing the entire tree
   */
  build(
    outputs: PlannerOutput[],
    fileRecordsMap: Map<string, FileRecord>
  ): VirtualNode {
    const root: VirtualNode = {
      id: 'root',
      name: 'Virtual Files',
      path: '/',
      type: 'folder',
      children: [],
    };

    for (const output of outputs) {
      const fileRecord = fileRecordsMap.get(output.file_id);
      if (!fileRecord) {
        console.warn(`File record not found for file_id: ${output.file_id}`);
        continue;
      }

      this.insertIntoTree(root, output, fileRecord);
    }

    // Sort children recursively
    this.sortTree(root);

    // Pre-compute file counts for all folder nodes (eliminates recursive counting on render)
    const countStartTime = Date.now();
    this.computeFileCounts(root);
    const countTime = Date.now() - countStartTime;
    if (outputs.length > 1000) {
      console.log(`[Performance] Computed file counts for tree with ${outputs.length.toLocaleString()} files in ${countTime}ms`);
    }

    return root;
  }

  /**
   * Build tree from stored virtual placements (from database).
   */
  buildFromPlacements(
    placements: VirtualPlacement[],
    fileRecordsMap: Map<string, FileRecord>
  ): VirtualNode {
    const outputs: PlannerOutput[] = placements.map((p) => ({
      file_id: p.file_id,
      virtual_path: p.virtual_path,
      tags: JSON.parse(p.tags),
      confidence: p.confidence,
      reason: p.reason,
    }));

    // build() already computes file counts, so just return it
    return this.build(outputs, fileRecordsMap);
  }

  /**
   * Build only the top-level structure (folders only, no files).
   * Much faster for initial load - files are loaded lazily when folders are expanded.
   * 
   * @param placements - Top-level virtual placements to build structure from (one level deep)
   * @param totalCount - Total count of all virtual placements (for root.fileCount)
   * @returns Root VirtualNode with only folder structure (no file children)
   */
  buildTopLevelOnly(placements: VirtualPlacement[], totalCount: number): VirtualNode {
    const root: VirtualNode = {
      id: 'root',
      name: 'Virtual Files',
      path: '/',
      type: 'folder',
      children: [],
    };

    // Track unique top-level folder paths
    const topLevelFolders = new Map<string, VirtualNode>();
    
    // Track file counts per folder path
    const folderFileCounts = new Map<string, number>();

    for (const placement of placements) {
      const pathParts = placement.virtual_path
        .split('/')
        .filter((p) => p.length > 0);

      if (pathParts.length === 0) continue;

      // Get top-level folder name (first part of path)
      const topLevelFolderName = pathParts[0];
      const topLevelPath = `/${topLevelFolderName}`;

      // Count files in this folder
      folderFileCounts.set(topLevelPath, (folderFileCounts.get(topLevelPath) || 0) + 1);

      // Create top-level folder if it doesn't exist
      if (!topLevelFolders.has(topLevelPath)) {
        const folder: VirtualNode = {
          id: `folder:${topLevelPath}`,
          name: topLevelFolderName,
          path: topLevelPath,
          type: 'folder',
          children: [], // Empty - will be loaded lazily
        };
        topLevelFolders.set(topLevelPath, folder);
        root.children.push(folder);
      }
    }

    // Set file counts for top-level folders
    for (const folder of root.children) {
      folder.fileCount = folderFileCounts.get(folder.path) || 0;
    }

    // Sort top-level folders
    root.children.sort((a, b) => {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    // Set root file count using totalCount parameter (accurate count of all files)
    root.fileCount = totalCount;

    return root;
  }

  /**
   * Insert a file into the tree at its virtual path.
   */
  private insertIntoTree(
    root: VirtualNode,
    output: PlannerOutput,
    fileRecord: FileRecord
  ): void {
    const pathParts = output.virtual_path
      .split('/')
      .filter((p) => p.length > 0);

    if (pathParts.length === 0) {
      return;
    }

    let currentNode = root;
    let currentPath = '';

    // Navigate/create folder structure (all parts except last)
    const folderParts = pathParts.slice(0, -1);
    for (const part of folderParts) {
      currentPath += '/' + part;

      let childFolder = currentNode.children.find(
        (c) => c.type === 'folder' && c.name === part
      );

      if (!childFolder) {
        childFolder = {
          id: `folder:${currentPath}`,
          name: part,
          path: currentPath,
          type: 'folder',
          children: [],
        };
        currentNode.children.push(childFolder);
      }

      currentNode = childFolder;
    }

    // Add the file node
    const fileName = pathParts[pathParts.length - 1];
    const fileNode: VirtualNode = {
      id: `file:${fileRecord.file_id}`,
      name: fileName,
      path: output.virtual_path,
      type: 'file',
      children: [],
      fileRecord,
      placement: output,
    };

    currentNode.children.push(fileNode);
  }

  /**
   * Recursively sort tree nodes (folders first, then alphabetically).
   */
  private sortTree(node: VirtualNode): void {
    node.children.sort((a, b) => {
      // Folders come before files
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      // Alphabetical within same type
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    // Recurse into folders
    for (const child of node.children) {
      if (child.type === 'folder') {
        this.sortTree(child);
      }
    }
  }

  /**
   * Recursively compute and store file counts for all folder nodes.
   * This eliminates the need to recursively count files on every render.
   * 
   * @param node - Node to compute counts for (recursively processes children)
   * @returns Total number of files in this node's subtree
   */
  private computeFileCounts(node: VirtualNode): number {
    if (node.type === 'file') {
      return 1; // Files count as 1
    }

    // For folders, sum up counts from all children
    let totalCount = 0;
    for (const child of node.children) {
      totalCount += this.computeFileCounts(child);
    }

    // Store the count in the node for O(1) lookup later
    node.fileCount = totalCount;

    return totalCount;
  }

  /**
   * Flatten the tree into a list of all file nodes.
   */
  flatten(root: VirtualNode): VirtualNode[] {
    const files: VirtualNode[] = [];
    this.collectFiles(root, files);
    return files;
  }

  private collectFiles(node: VirtualNode, files: VirtualNode[]): void {
    if (node.type === 'file') {
      files.push(node);
    }
    for (const child of node.children) {
      this.collectFiles(child, files);
    }
  }

  /**
   * Get statistics about the virtual tree.
   */
  getStats(root: VirtualNode): {
    totalFolders: number;
    totalFiles: number;
    maxDepth: number;
  } {
    let totalFolders = 0;
    let totalFiles = 0;
    let maxDepth = 0;

    const traverse = (node: VirtualNode, depth: number) => {
      if (node.type === 'folder') {
        totalFolders++;
      } else {
        totalFiles++;
      }
      maxDepth = Math.max(maxDepth, depth);

      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    };

    traverse(root, 0);
    return { totalFolders, totalFiles, maxDepth };
  }

  /**
   * Get direct children of a virtual folder path.
   * Returns empty array if path doesn't exist or is a file.
   */
  getChildren(root: VirtualNode, virtualPath: string): VirtualNode[] {
    const node = this.getNodeByPath(root, virtualPath);
    if (!node || node.type !== 'folder') {
      return [];
    }
    return node.children;
  }

  /**
   * Find a node in the tree by its virtual path.
   * Returns undefined if not found.
   */
  getNodeByPath(root: VirtualNode, virtualPath: string): VirtualNode | undefined {
    if (virtualPath === '/' || virtualPath === '') {
      return root;
    }

    const pathParts = virtualPath
      .split('/')
      .filter((p) => p.length > 0);

    let currentNode = root;
    for (const part of pathParts) {
      const child = currentNode.children.find((c) => c.name === part);
      if (!child) {
        return undefined;
      }
      currentNode = child;
    }

    return currentNode;
  }
}
