const { spawn } = require('node:child_process');

const args = process.argv.slice(2);
const env = { ...process.env };
if (args[0] === '--node') {
  args.shift();
  env.ELECTRON_RUN_AS_NODE = '1';
} else {
  delete env.ELECTRON_RUN_AS_NODE;
}
const child = spawn(require('electron'), args, { stdio: 'inherit', env });
child.on('error', (error) => {
  console.error(`Could not start Electron: ${error.message}. Run npm ci from the project root.`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
