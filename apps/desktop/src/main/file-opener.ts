import { shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Opens a file with the default macOS application.
 * 
 * Security: This function validates that the path exists and is a file
 * before attempting to open it. It does not allow opening directories
 * or non-existent paths.
 */
export async function openFile(filePath: string): Promise<void> {
  // Normalize the path
  const normalizedPath = path.normalize(filePath);

  // Security check: Ensure the file exists
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`File does not exist: ${normalizedPath}`);
  }

  // Security check: Ensure it's a file, not a directory
  const stats = fs.statSync(normalizedPath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${normalizedPath}`);
  }

  // Open with default application
  const errorMessage = await shell.openPath(normalizedPath);
  
  if (errorMessage) {
    throw new Error(`Failed to open file: ${errorMessage}`);
  }
}
