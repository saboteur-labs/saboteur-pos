export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS contexts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  repos       TEXT DEFAULT '[]',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  path       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  context_id TEXT DEFAULT NULL,
  enabled    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  state         TEXT NOT NULL,
  context_id    TEXT NOT NULL REFERENCES contexts(id),
  priority      TEXT DEFAULT 'normal',
  energy        TEXT DEFAULT NULL,
  effort        TEXT DEFAULT NULL,
  blocks        TEXT DEFAULT '[]',
  blocked_by    TEXT DEFAULT '[]',
  note_id       TEXT DEFAULT NULL,
  repo          TEXT DEFAULT NULL,
  branch        TEXT DEFAULT NULL,
  state_history TEXT DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_index (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES sources(id),
  type       TEXT NOT NULL,
  title      TEXT,
  tags       TEXT DEFAULT '[]',
  task_id    TEXT DEFAULT NULL,
  context_id TEXT DEFAULT NULL,
  path       TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS commits (
  sha         TEXT PRIMARY KEY,
  repo        TEXT NOT NULL,
  branch      TEXT,
  task_id     TEXT REFERENCES tasks(id),
  message     TEXT NOT NULL,
  author_ts   TEXT NOT NULL,
  sub_context TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_context ON tasks(context_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state   ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);

CREATE INDEX IF NOT EXISTS idx_ki_source  ON knowledge_index(source_id);
CREATE INDEX IF NOT EXISTS idx_ki_type    ON knowledge_index(type);
CREATE INDEX IF NOT EXISTS idx_ki_context ON knowledge_index(context_id);
CREATE INDEX IF NOT EXISTS idx_ki_task    ON knowledge_index(task_id);
CREATE INDEX IF NOT EXISTS idx_ki_updated ON knowledge_index(updated_at);

CREATE INDEX IF NOT EXISTS idx_commits_task        ON commits(task_id);
CREATE INDEX IF NOT EXISTS idx_commits_repo        ON commits(repo);
CREATE INDEX IF NOT EXISTS idx_commits_author_ts   ON commits(author_ts);
`;
