import { spawn } from 'child_process';
import * as net from 'net';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { homedir } from 'os';

const PORT = 9421;
const HOST = '127.0.0.1';
const PID_FILE = join(homedir(), 'saboteur', 'ui.pid');

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
  const serverScript = join(__dirname, '..', 'server.js');

  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (child.pid !== undefined) {
    writeFileSync(PID_FILE, String(child.pid), 'utf-8');
  }

  process.stdout.write(`http://${HOST}:${PORT}\n`);
}

export function runUiStop(): void {
  if (!existsSync(PID_FILE)) {
    process.stderr.write('UI server is not running\n');
    process.exit(1);
  }

  const raw = readFileSync(PID_FILE, 'utf-8').trim();
  const pid = parseInt(raw, 10);

  if (isNaN(pid)) {
    unlinkSync(PID_FILE);
    process.stderr.write('UI server is not running (stale PID file removed)\n');
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
    unlinkSync(PID_FILE);
    process.stdout.write('UI server stopped\n');
  } catch (err: unknown) {
    unlinkSync(PID_FILE);
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      process.stderr.write('UI server is not running (stale PID file removed)\n');
      process.exit(1);
    }
    throw err;
  }
}
