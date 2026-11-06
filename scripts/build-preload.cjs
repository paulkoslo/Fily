const path = require('node:path');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
build({
  entryPoints: [path.join(root, 'apps/desktop/src/preload/index.ts')],
  outfile: path.join(root, 'apps/desktop/dist/preload/index.js'),
  bundle: true,
  platform: 'node',
  // Sandboxed preloads provide require('electron'), but no CommonJS module global.
  format: 'iife',
  target: 'node18',
  external: ['electron'],
  metafile: true,
}).then((result) => {
  const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
  if (imports.some((entry) => entry.external && entry.path !== 'electron')) {
    throw new Error('Sandboxed preload must not import Node modules or the core runtime');
  }
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
