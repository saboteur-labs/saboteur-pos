import http from 'node:http';
import https from 'node:https';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { getDb } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../ui/server/http.js';
import { FileWatcher } from '../ui/server/watch.js';
import { createTestEnv, type TestEnv } from './helpers.js';

const TEST_PORT = 19422;

const LOOPBACK = new Set(['', '127.0.0.1', 'localhost', '::1']);

function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.split(':')[0]);
}

function get(port: number, path: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    }).on('error', reject);
  });
}

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('No outbound network requests', () => {
  let env: TestEnv;
  let watcher: FileWatcher;
  let server: Server;
  const blockedCalls: string[] = [];
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    // Intercept http.request and https.request for non-loopback destinations.
    function intercept(mod: typeof http | typeof https, scheme: string): void {
      const orig = mod.request.bind(mod);
      const patched = function (urlOrOptions: Parameters<typeof mod.request>[0], ...rest: unknown[]) {
        let host = '';
        if (typeof urlOrOptions === 'string') {
          host = new URL(urlOrOptions).hostname;
        } else if (urlOrOptions instanceof URL) {
          host = urlOrOptions.hostname;
        } else {
          host = (urlOrOptions as { hostname?: string; host?: string }).hostname
            ?? (urlOrOptions as { hostname?: string; host?: string }).host
            ?? '';
        }
        if (!isLoopback(host)) {
          blockedCalls.push(`${scheme}://${host}`);
          throw new Error(`Outbound network request blocked: ${scheme}://${host}`);
        }
        return orig(urlOrOptions as Parameters<typeof orig>[0], ...rest as Parameters<typeof orig>[1][]);
      };
      (mod as unknown as Record<string, unknown>).request = patched;
      restores.push(() => { (mod as unknown as Record<string, unknown>).request = orig; });
    }

    intercept(http, 'http');
    intercept(https, 'https');

    // Intercept globalThis.fetch (Node 18+ built-in via undici) for non-loopback destinations.
    if (typeof globalThis.fetch === 'function') {
      const origFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const host = new URL(url).hostname;
        if (!isLoopback(host)) {
          blockedCalls.push(url);
          return Promise.reject(new Error(`Outbound fetch blocked: ${url}`));
        }
        return origFetch(input, init);
      };
      restores.push(() => { globalThis.fetch = origFetch; });
    }

    env = createTestEnv();
    const db = getDb(env.dbPath);
    const config = loadConfig(env.configPath);
    watcher = new FileWatcher(env.dbPath, env.notesPath);
    server = createServer(db, config, watcher);
    await new Promise<void>((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
    await watcher.ready;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await watcher.close();
    env.cleanup();
    for (const restore of restores) restore();
  });

  it('GET /api/briefing returns 200', async () => {
    const { status } = await get(TEST_PORT, '/api/briefing');
    expect(status).toBe(200);
  });

  it('GET /api/tasks returns 200', async () => {
    const { status } = await get(TEST_PORT, '/api/tasks');
    expect(status).toBe(200);
  });

  it('GET /api/tasks?view=active returns 200', async () => {
    const { status } = await get(TEST_PORT, '/api/tasks?view=active');
    expect(status).toBe(200);
  });

  it('GET /api/notes returns 200', async () => {
    const { status } = await get(TEST_PORT, '/api/notes');
    expect(status).toBe(200);
  });

  it('WebSocket at /ws opens successfully', async () => {
    const ws = await wsConnect(TEST_PORT);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('no outbound network requests were made during any of the above', () => {
    expect(blockedCalls).toHaveLength(0);
  });
});
