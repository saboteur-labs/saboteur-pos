import { createServer as nodeCreateServer } from 'http';
import type { Server } from 'http';
import type Database from 'better-sqlite3';
import type { Config } from '../../src/config.js';
import { handleRequest } from './routes.js';
import { mountWebSocket } from './ws.js';
import type { FileWatcher } from './watch.js';

export function createServer(
  db: Database.Database,
  config: Config,
  watcher: FileWatcher,
): Server {
  const server = nodeCreateServer((req, res) => {
    handleRequest(req, res, db, config);
  });

  mountWebSocket(server, watcher);

  return server;
}
