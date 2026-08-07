import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { CREATE_TABLES } from '../../db/schema.js';
import type { Config } from '../../config.js';
import {
  collectContextRecap,
  formatContextRecap,
  parseRecapRequest,
  type ContextRecap,
} from './recap.js';

const ALL = parseRecapRequest(['done_tasks', 'linked_commits', 'blocked_tasks']);

/** No repos_dir, so commit indexing is a no-op — commit linking is covered separately. */
const config = { repos_dir: '/nonexistent', sources: [] } as unknown as Config;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(CREATE_TABLES);
  for (const slug of ['saboteur-pos', 'offbeat-fm']) {
    db.prepare(
      `INSERT INTO contexts (id, name, repos, created_at) VALUES (?, ?, '[]', '2026-01-01T00:00:00Z')`,
    ).run(slug, slug);
  }
  return db;
}

function addTask(
  db: Database.Database,
  opts: { id: string; title: string; context: string; state: string; doneAt?: string; blockedBy?: string[] },
): void {
  const history = [{ state: 'backlog', timestamp: '2026-07-01T00:00:00.000Z' }];
  if (opts.doneAt) history.push({ state: 'done', timestamp: opts.doneAt });

  db.prepare(
    `INSERT INTO tasks (id, title, state, context_id, priority, blocks, blocked_by,
                        state_history, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'normal', '[]', ?, ?, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
  ).run(
    opts.id,
    opts.title,
    opts.state,
    opts.context,
    JSON.stringify(opts.blockedBy ?? []),
    JSON.stringify(history),
  );
}

describe('parseRecapRequest', () => {
  it('reads the parts the directive asked for', () => {
    expect(ALL).toEqual({ doneTasks: true, linkedCommits: true, blockedTasks: true });
  });

  it('leaves unrequested parts off', () => {
    expect(parseRecapRequest(['done_tasks'])).toEqual({
      doneTasks: true,
      linkedCommits: false,
      blockedTasks: false,
    });
  });
});

describe('collectContextRecap', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('reports tasks finished since the cutoff', () => {
    addTask(db, {
      id: 'task-1',
      title: 'Ship kaizen parser',
      context: 'saboteur-pos',
      state: 'done',
      doneAt: '2026-07-30T12:00:00.000Z',
    });
    const recap = collectContextRecap(db, config, 'saboteur-pos', '2026-07-27T00:00:00.000Z', ALL);
    expect(recap.shipped.map((t) => t.title)).toEqual(['Ship kaizen parser']);
  });

  it('excludes tasks finished before the cutoff', () => {
    addTask(db, {
      id: 'task-1',
      title: 'Last month',
      context: 'saboteur-pos',
      state: 'done',
      doneAt: '2026-06-01T12:00:00.000Z',
    });
    const recap = collectContextRecap(db, config, 'saboteur-pos', '2026-07-27T00:00:00.000Z', ALL);
    expect(recap.shipped).toEqual([]);
  });

  it('scopes to the given context', () => {
    addTask(db, {
      id: 'task-1',
      title: 'Elsewhere',
      context: 'offbeat-fm',
      state: 'done',
      doneAt: '2026-07-30T12:00:00.000Z',
    });
    const recap = collectContextRecap(db, config, 'saboteur-pos', '2026-07-27T00:00:00.000Z', ALL);
    expect(recap.shipped).toEqual([]);
  });

  it('reports blocked tasks with their blocker titles', () => {
    addTask(db, { id: 'task-1', title: 'The blocker', context: 'saboteur-pos', state: 'active' });
    addTask(db, {
      id: 'task-2',
      title: 'Waiting on it',
      context: 'saboteur-pos',
      state: 'blocked',
      blockedBy: ['task-1'],
    });
    const recap = collectContextRecap(db, config, 'saboteur-pos', '2026-07-27T00:00:00.000Z', ALL);
    expect(recap.blocked).toHaveLength(1);
    expect(recap.blocked[0].task.title).toBe('Waiting on it');
    expect(recap.blocked[0].blockerTitles).toEqual(['The blocker']);
  });

  it('skips the parts the directive did not request', () => {
    addTask(db, {
      id: 'task-1',
      title: 'Done',
      context: 'saboteur-pos',
      state: 'done',
      doneAt: '2026-07-30T12:00:00.000Z',
    });
    addTask(db, { id: 'task-2', title: 'Blocked', context: 'saboteur-pos', state: 'blocked' });

    const recap = collectContextRecap(
      db,
      config,
      'saboteur-pos',
      '2026-07-27T00:00:00.000Z',
      parseRecapRequest(['done_tasks']),
    );
    expect(recap.shipped).toHaveLength(1);
    expect(recap.blocked).toEqual([]);
  });

  // Caveat: requesting linked_commits calls indexCommits, which refreshes the
  // derived `commits` cache — the same thing `sab standup` does. This asserts
  // the user's own data is untouched, which is the guarantee that matters.
  it('does not touch task state or the knowledge index', () => {
    addTask(db, {
      id: 'task-1',
      title: 'Done',
      context: 'saboteur-pos',
      state: 'done',
      doneAt: '2026-07-30T12:00:00.000Z',
    });
    const before = db.prepare(`SELECT * FROM tasks`).all();
    collectContextRecap(db, config, 'saboteur-pos', '2026-07-27T00:00:00.000Z', ALL);
    expect(db.prepare(`SELECT * FROM tasks`).all()).toEqual(before);
    expect(db.prepare(`SELECT count(*) AS n FROM knowledge_index`).get()).toEqual({ n: 0 });
  });
});

describe('formatContextRecap', () => {
  const empty: ContextRecap = { shipped: [], commitsByTask: new Map(), blocked: [] };

  it('states explicitly when nothing moved, rather than printing blank space', () => {
    const out = formatContextRecap('OffBeat-FM', empty);
    expect(out).toContain('OffBeat-FM');
    expect(out).toContain('no movement recorded');
  });

  it('lists shipped tasks with their linked commits indented beneath', () => {
    const db = makeDb();
    addTask(db, {
      id: 'task-1',
      title: 'Ship it',
      context: 'saboteur-pos',
      state: 'done',
      doneAt: '2026-07-30T12:00:00.000Z',
    });
    const recap = collectContextRecap(db, config, 'saboteur-pos', '2026-07-01T00:00:00.000Z', ALL);
    recap.commitsByTask.set('task-1', [
      {
        sha: 'abcdef1234567890',
        message: 'feat: ship it\n\nbody text',
        repo: 'saboteur-pos',
        task_id: 'task-1',
      } as never,
    ]);

    const out = formatContextRecap('Saboteur POS', recap);
    expect(out).toContain('Ship it');
    expect(out).toContain('abcdef1');
    expect(out).toContain('feat: ship it');
    // Only the commit subject, not its body.
    expect(out).not.toContain('body text');
    db.close();
  });
});
