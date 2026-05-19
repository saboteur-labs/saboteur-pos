import type { IncomingMessage, ServerResponse } from 'http';
import type Database from 'better-sqlite3';
import type { Config } from '../../src/config.js';
import { getTasks } from './data/tasks.js';
import { getNotes, getNoteById } from './data/notes.js';
import { getBriefingData } from './data/briefing.js';

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

export function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
  config: Config,
): void {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/briefing') {
      send(res, 200, getBriefingData(db, config));
      return;
    }

    if (pathname === '/api/tasks') {
      const view = url.searchParams.get('view') ?? undefined;
      send(res, 200, getTasks(db, { view, contextId: config.active_context }));
      return;
    }

    if (pathname === '/api/notes') {
      send(res, 200, getNotes(db, { contextId: config.active_context }));
      return;
    }

    const noteMatch = /^\/api\/notes\/([^/]+)$/.exec(pathname);
    if (noteMatch) {
      const note = getNoteById(db, decodeURIComponent(noteMatch[1]));
      if (!note) {
        send(res, 404, { error: 'Note not found' });
        return;
      }
      send(res, 200, note);
      return;
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
