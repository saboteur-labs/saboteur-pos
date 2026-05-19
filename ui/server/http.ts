import { createServer as nodeCreateServer } from 'http';
import type { Server } from 'http';
import type Database from 'better-sqlite3';
import type { Config } from '../../src/config.js';
import { handleRequest } from './routes.js';

export function createServer(db: Database.Database, config: Config): Server {
  return nodeCreateServer((req, res) => {
    handleRequest(req, res, db, config);
  });
}
