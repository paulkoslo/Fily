const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const desktop = args[0] === '--desktop';
if (desktop) args.shift();
const testDir = path.join(root, desktop ? 'apps/desktop/tests' : 'packages/core/tests');
const files = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.js')).sort();
if (files.length === 0) throw new Error('No core tests found');

// Use the same native ABI as the app, including in CI. No per-runtime rebuilds
// or optional integration tests: a broken SQLite binding must fail the suite.
const child = spawn(require('electron'), [
  '--test', '--test-timeout=30000', ...args, ...files.map((name) => path.join(testDir, name)),
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('error', (error) => {
  console.error(`Could not run tests: ${error.message}. Run npm ci from the project root.`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
