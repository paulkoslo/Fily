const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Never load project .env files, user credentials or the normal Fily database.
delete process.env.OPENAI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.LLM_MODEL;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-smoke-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
let db;
let window;
let finished = false;

async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  window?.destroy();
  await db?.close();
  fs.rmSync(profile, { recursive: true, force: true });
  if (error) console.error(error);
  app.exit(error ? 1 : 0);
}

const deadline = setTimeout(() => finish(new Error('Desktop smoke test timed out')), 30000);
app.whenReady().then(async () => {
  const { DatabaseManager, Crawler, WatcherManager } = require('@virtual-finder/core');
  const { ApiKeyStore } = require('../apps/desktop/dist/main/api-key-store');
  const { registerIpcHandlers } = require('../apps/desktop/dist/main/ipc-handlers');
  db = new DatabaseManager(path.join(profile, 'smoke.db'));
  const library = path.join(profile, 'library');
  fs.mkdirSync(library);
  fs.writeFileSync(path.join(library, 'note.txt'), 'Synthetic smoke-test document');
  const source = await db.addSource('Smoke library', library);
  const scan = await new Crawler(db).scan(source.id, library);
  assert.deepEqual(scan.errors, []);
  assert.equal(scan.filesScanned, 1);

  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../apps/desktop/dist/preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Match the current app; sandbox hardening is the next milestone.
    },
  });
  window.webContents.on('preload-error', (_event, _file, error) => finish(error));
  window.webContents.on('render-process-gone', (_event, details) => finish(new Error(details.reason)));
  registerIpcHandlers(ipcMain, db, () => window, new WatcherManager(db),
    new ApiKeyStore({ userDataPath: profile }));
  await window.loadFile(path.resolve(__dirname, '../apps/ui/dist/index.html'));

  const result = await window.webContents.executeJavaScript(`(async () => {
    const sources = await window.api.getSources();
    const files = await window.api.listFiles({ sourceId: ${source.id} });
    const keys = await window.api.getApiKeyStatus();
    return { rendered: document.getElementById('root').childElementCount > 0, sources, files, keys };
  })()`);
  assert.equal(result.rendered, true, 'React must render the built UI');
  assert.equal(result.sources.success, true);
  assert.equal(result.sources.sources.length, 1);
  assert.equal(result.files.success, true);
  assert.equal(result.files.files.length, 1);
  assert.equal(result.files.files[0].name, 'note.txt');
  assert.equal(result.keys.hasKey, false);
  console.log('Desktop smoke passed: built UI, preload, SQLite and IPC using a temporary profile.');
  await finish();
}).catch(finish);
