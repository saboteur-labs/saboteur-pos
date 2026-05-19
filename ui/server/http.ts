import { createServer as nodeCreateServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, extname, resolve, normalize } from 'path';
import type { Server, ServerResponse } from 'http';
import type Database from 'better-sqlite3';
import type { Config } from '../../src/config.js';
import { handleRequest } from './routes.js';
import { mountWebSocket } from './ws.js';
import type { FileWatcher } from './watch.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(res: ServerResponse, distDir: string, pathname: string): void {
  // Prevent directory traversal
  const safe = resolve(distDir, '.' + normalize('/' + decodeURIComponent(pathname)));
  if (!safe.startsWith(distDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  let filePath = safe;

  // SPA fallback: if the resolved path has no extension or doesn't exist, serve index.html
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end();
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
}

export function createServer(
  db: Database.Database,
  config: Config,
  watcher: FileWatcher,
  distDir?: string,
): Server {
  const server = nodeCreateServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (pathname.startsWith('/api/') || pathname === '/api') {
      handleRequest(req, res, db, config);
      return;
    }

    if (distDir) {
      serveStatic(res, distDir, pathname);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  mountWebSocket(server, watcher);

  return server;
}
