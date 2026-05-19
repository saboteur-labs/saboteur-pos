import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig, resolvePath } from '../../src/config.js';
import { getDb } from '../../src/db/index.js';
import { FileWatcher } from './watch.js';
import { createServer } from './http.js';

const PORT = 9421;
const HOST = '127.0.0.1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'ui', 'dist');

const config = loadConfig();
const dbPath = resolvePath(config.db_path);
const noteSource = config.sources.find((s) => s.type === 'note');
const notesDirPath = noteSource ? resolvePath(noteSource.path) : join(dirname(dbPath), 'notes');

const db = getDb(dbPath);
const watcher = new FileWatcher(dbPath, notesDirPath);
const server = createServer(db, config, watcher, distDir);

server.listen(PORT, HOST, () => {
  process.stdout.write(`http://${HOST}:${PORT}\n`);
});

process.on('SIGTERM', () => {
  server.close();
  watcher.close().catch(() => {});
  db.close();
});
