const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
let server;
let desktop;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  desktop?.kill('SIGTERM');
  await server?.close();
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

(async () => {
  const { createServer } = await import('vite');
  server = await createServer({
    root: path.join(root, 'apps/ui'),
    configFile: path.join(root, 'apps/ui/vite.config.ts'),
  });
  if (stopping) return server.close();
  // listen() verifies this process owns the configured port before Electron
  // starts; a port occupied by another server must not load an unrelated page.
  await server.listen();
  server.printUrls();
  if (stopping) return server.close();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.argv.includes('--smoke')
    ? [path.join(root, 'scripts/smoke-desktop.cjs'), '--dev'] : ['.'];
  desktop = spawn(require('electron'), args, {
    cwd: path.join(root, 'apps/desktop'), stdio: 'inherit', env,
  });
  desktop.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  desktop.on('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
})().catch((error) => {
  console.error(error.message);
  stop(1);
});
