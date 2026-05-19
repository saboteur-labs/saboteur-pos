import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { getDb } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../ui/server/http.js';
import { FileWatcher } from '../ui/server/watch.js';
import { createTestEnv, type TestEnv } from './helpers.js';
import { utimesSync } from 'fs';
import type { Server } from 'http';

const TEST_PORT = 19421;

function touchFile(path: string): void {
  const now = new Date();
  utimesSync(path, now, now);
}

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for WebSocket message`)),
      timeoutMs,
    );
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

describe('WebSocket channel', () => {
  let env: TestEnv;
  let watcher: FileWatcher;
  let server: Server;

  beforeEach(async () => {
    env = createTestEnv();
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    watcher = new FileWatcher(env.dbPath, env.notesPath);
    server = createServer(db, config, watcher);
    await new Promise<void>((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
    await watcher.ready;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await watcher.close();
    env.cleanup();
  });

  it('broadcasts {type:"tasks"} to all connected clients on DB change', async () => {
    const ws1 = await wsConnect(TEST_PORT);
    const ws2 = await wsConnect(TEST_PORT);

    const msg1 = waitForMessage(ws1, 1000);
    const msg2 = waitForMessage(ws2, 1000);

    touchFile(env.dbPath);

    const [raw1, raw2] = await Promise.all([msg1, msg2]);
    expect(JSON.parse(raw1)).toEqual({ type: 'tasks' });
    expect(JSON.parse(raw2)).toEqual({ type: 'tasks' });

    ws1.close();
    ws2.close();
  });

  it('inbound messages from client trigger no server-side action', async () => {
    const ws = await wsConnect(TEST_PORT);

    // Send a message and give the server time to (not) react
    ws.send('should be ignored');
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Server is still alive and accepts new connections
    const ws2 = await wsConnect(TEST_PORT);
    expect(ws2.readyState).toBe(WebSocket.OPEN);

    ws.close();
    ws2.close();
  });
});
