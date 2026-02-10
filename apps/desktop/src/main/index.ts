// Electron app main process
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import { app, BrowserWindow, ipcMain } from 'electron';
import { DatabaseManager, WatcherManager } from '@virtual-finder/core';
import { registerIpcHandlers } from './ipc-handlers';

// Load .env file from project root
// Try multiple possible locations (dev vs production)
const envPaths = [
  path.join(__dirname, '../../../../.env'), // Development: apps/desktop/dist/main -> project root
  path.join(process.cwd(), '.env'), // Current working directory
];

// Try app path if available (may not work before app is ready)
try {
  envPaths.push(path.join(app.getAppPath(), '.env')); // App path (for packaged apps)
} catch (err) {
  // Ignore - app may not be ready yet
}

let envLoaded = false;
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    envLoaded = true;
    console.log(`[Main] Loaded .env from: ${envPath}`);
    break;
  }
}

if (!envLoaded) {
  console.warn('[Main] No .env file found. Using environment variables from system.');
}

// Validate required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('[Main] ERROR: OPENAI_API_KEY is not set!');
  console.error('[Main] Please create a .env file in the project root with your OpenAI API key.');
  console.error('[Main] Example: OPENAI_API_KEY=your-api-key-here');
  // Don't exit - let the app start but AI features will fail gracefully
}

// Set app name and userData path BEFORE any app.getPath() calls to ensure consistent paths
app.setName('Fily');
// Explicitly set userData path to ensure consistency across rebuilds
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'Fily');
app.setPath('userData', userDataPath);

// Keep a global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let db: DatabaseManager | null = null;
let watcherManager: WatcherManager | null = null;

// Determine if we're in development mode (must be called after app is ready)
function isDev(): boolean {
  return !app.isPackaged;
}

function getDbPath(): string {
  // Use the explicitly set userData path
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'virtual-finder.db');
  console.log(`App name: ${app.getName()}`);
  console.log(`UserData path: ${userDataPath}`);
  console.log(`Database path: ${dbPath}`);
  return dbPath;
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'index.js');
}

function getRendererUrl(): string {
  if (isDev()) {
    // In development, load from Vite dev server
    return 'http://localhost:5173';
  }
  // In production, load from built files
  const rendererPath = path.join(process.resourcesPath, 'ui', 'index.html');
  return `file://${rendererPath}`;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Virtual Finder',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Load the renderer
  const url = getRendererUrl();
  console.log(`Loading renderer from: ${url}`);

  // In dev builds we used to always auto-open DevTools.
  // This is now controlled via the FILY_OPEN_DEVTOOLS env var so the app
  // can run cleanly without the console unless explicitly requested.
  const shouldOpenDevTools = process.env.FILY_OPEN_DEVTOOLS === '1';

  if (isDev()) {
    await mainWindow.loadURL(url);
    if (shouldOpenDevTools) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    await mainWindow.loadURL(url);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeApp(): Promise<void> {
  // Initialize database
  const dbPath = getDbPath(); // getDbPath() already logs the path
  db = new DatabaseManager(dbPath);

  // Note: We no longer auto-create Downloads source on startup.
  // Users can add sources manually if they want. This prevents
  // deleted sources from reappearing after restart.

  // Initialize watcher manager
  watcherManager = new WatcherManager(db);

  // Auto-start watchers for all enabled sources
  const sources = await db.getSources();
  for (const source of sources) {
    if (source.enabled) {
      watcherManager.startWatching(source.id, source.path);
      console.log(`[Main] Auto-started watcher for source: ${source.name} (${source.id})`);
    }
  }

  // Register IPC handlers
  registerIpcHandlers(ipcMain, db, () => mainWindow, watcherManager);

  // Create the main window
  await createWindow();
}

// App lifecycle
app.whenReady().then(initializeApp).catch((err) => {
  console.error('Failed to initialize app:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  // Stop all watchers before quitting
  if (watcherManager) {
    watcherManager.stopAll();
    console.log('[Main] Stopped all watchers');
  }

  if (db) {
    // Save database synchronously before closing to ensure persistence
    db.saveSync();
    await db.close();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
