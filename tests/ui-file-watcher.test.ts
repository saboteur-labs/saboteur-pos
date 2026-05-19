import { utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileWatcher, type ChangeType } from '../ui/server/watch.js';
import { getDb } from '../src/db/index.js';
import { createTestEnv, type TestEnv } from './helpers.js';

function waitForEvent(
  watcher: FileWatcher,
  type: ChangeType,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for '${type}' event`)),
      timeoutMs,
    );
    watcher.on('change', (t) => {
      if (t === type) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function collectEvents(watcher: FileWatcher, durationMs: number): Promise<ChangeType[]> {
  return new Promise((resolve) => {
    const events: ChangeType[] = [];
    watcher.on('change', (t) => events.push(t));
    setTimeout(() => resolve(events), durationMs);
  });
}

function touchFile(path: string): void {
  const now = new Date();
  utimesSync(path, now, now);
}

describe('FileWatcher', () => {
  let env: TestEnv;
  let watcher: FileWatcher;

  beforeEach(() => {
    env = createTestEnv();
    // Ensure DB file exists
    const db = getDb(env.dbPath);
    db.close();
  });

  afterEach(async () => {
    await watcher.close();
    env.cleanup();
  });

  it('emits tasks event when DB file is touched', async () => {
    watcher = new FileWatcher(env.dbPath, env.notesPath);
    const received = waitForEvent(watcher, 'tasks', 500);
    touchFile(env.dbPath);
    await received;
  });

  it('emits briefing event when DB file is touched', async () => {
    watcher = new FileWatcher(env.dbPath, env.notesPath);
    const received = waitForEvent(watcher, 'briefing', 500);
    touchFile(env.dbPath);
    await received;
  });

  it('emits notes event when a .md file is created', async () => {
    watcher = new FileWatcher(env.dbPath, env.notesPath);
    const received = waitForEvent(watcher, 'notes', 500);
    writeFileSync(join(env.notesPath, 'new-note.md'), '# Hello\n');
    await received;
  });

  it('rapid DB writes coalesce into one tasks event', async () => {
    watcher = new FileWatcher(env.dbPath, env.notesPath);
    await watcher.ready;

    const collecting = collectEvents(watcher, 600);

    // Five rapid touches within a few ms — all within the 250ms debounce window
    for (let i = 0; i < 5; i++) {
      touchFile(env.dbPath);
    }

    const events = await collecting;
    const taskEvents = events.filter((e) => e === 'tasks');
    expect(taskEvents).toHaveLength(1);
  });
});
