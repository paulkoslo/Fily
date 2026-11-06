const fs = require('node:fs');
const path = require('node:path');
const workspace = process.argv[2];
if (!['packages/core', 'apps/desktop'].includes(workspace)) throw new Error('Unknown build workspace');
// TypeScript leaves emitted files behind when source modules are deleted or
// moved into folders. A stale foo.js shadows the new foo/index.js at runtime.
fs.rmSync(path.join(__dirname, '..', workspace, 'dist'), { recursive: true, force: true });
