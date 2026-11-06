const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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
let outsider;
let finished = false;

async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  window?.destroy();
  outsider?.destroy();
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
  const { secureWindow } = require('../apps/desktop/dist/main/security');
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
      sandbox: true,
    },
  });
  window.webContents.on('preload-error', (_event, _file, error) => finish(error));
  window.webContents.on('render-process-gone', (_event, details) => finish(new Error(details.reason)));
  const urlFlag = process.argv.indexOf('--renderer-url');
  const developmentUrl = urlFlag >= 0 ? process.argv[urlFlag + 1] : 'http://localhost:5180/';
  const parsedDevUrl = new URL(developmentUrl);
  assert.equal(parsedDevUrl.protocol, 'http:');
  assert.equal(parsedDevUrl.hostname, 'localhost');
  const rendererUrl = process.argv.includes('--dev') ? developmentUrl
    : pathToFileURL(path.resolve(__dirname, '../apps/ui/dist/index.html')).href;
  secureWindow(window, rendererUrl);
  const apiKeyStore = new ApiKeyStore({ userDataPath: profile });
  apiKeyStore.loadEnv();
  registerIpcHandlers(ipcMain, db, () => window, new WatcherManager(db), apiKeyStore, rendererUrl);
  await window.loadURL(rendererUrl);

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
  assert.equal(window.webContents.getLastWebPreferences().sandbox, true);
  const blocked = await window.webContents.executeJavaScript(`(async () => {
    const forgedSource = await window.api.addSource({ name: 'Forged', path: ${JSON.stringify(profile)} });
    const traversal = await window.api.openFolder({ sourceId: ${source.id}, relativePath: '..' });
    const missingFile = await window.api.openFile({ fileId: 'unknown-file' });
    const script = document.createElement('script');
    script.textContent = 'window.__inlineExecuted = true';
    document.body.appendChild(script);
    return { forgedSource, traversal, missingFile, inlineExecuted: !!window.__inlineExecuted,
      popupBlocked: window.open('https://example.com') === null, nodeExposed: typeof window.require !== 'undefined' };
  })()`);
  assert.equal(blocked.forgedSource.success, false);
  assert.equal(blocked.traversal.success, false);
  assert.equal(blocked.missingFile.success, false);
  assert.equal(blocked.inlineExecuted, false);
  assert.equal(blocked.popupBlocked, true);
  assert.equal(blocked.nodeExposed, false);
  outsider = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, '../apps/desktop/dist/preload/index.js'),
    sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  secureWindow(outsider, rendererUrl);
  await outsider.loadURL(rendererUrl);
  const rejected = await outsider.webContents.executeJavaScript(`window.api.getApiKeyStatus()
    .then(result => result.success === false, () => true)`);
  assert.equal(rejected, true, 'Another window must not access the main window IPC');
  console.log(`Desktop smoke passed (${process.argv.includes('--dev') ? 'development' : 'built'}): sandboxed UI, preload, SQLite, trusted IPC, source boundaries and CSP.`);
  await finish();
}).catch(finish);
