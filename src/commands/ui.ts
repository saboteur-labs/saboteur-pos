import { spawn } from 'child_process';
import * as net from 'net';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const PORT = 9421;
const HOST = '127.0.0.1';

function isPortInUse(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(PORT, HOST);
  });
}

export async function runUi(): Promise<void> {
  const inUse = await isPortInUse();
  if (inUse) {
    process.stderr.write(`port ${PORT} already in use\n`);
    process.exit(1);
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const uiDir = join(__dirname, '..', '..', 'ui');

  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--port', String(PORT), '--host', HOST],
    {
      cwd: uiDir,
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();

  process.stdout.write(`http://${HOST}:${PORT}\n`);
}
