const path = require('node:path');
const { version } = require('electron/package.json');

const root = path.resolve(__dirname, '..');
console.log(`Preparing better-sqlite3 for installed Electron ${version} (${process.arch})`);
import('@electron/rebuild').then(({ rebuild }) => rebuild({
  // Rebuild from the workspace that declares SQLite. The root package contains
  // only workspace declarations, which the rebuild tool does not walk itself.
  buildPath: path.join(root, 'packages/core'),
  projectRootPath: root,
  electronVersion: version,
  onlyModules: ['better-sqlite3'],
  force: true,
})).catch((error) => {
  console.error('Native rebuild failed. Check Python 3 and the platform compiler tools.');
  console.error(error.message);
  process.exitCode = 1;
});
