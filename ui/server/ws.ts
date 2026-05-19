import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { FileWatcher, ChangeType } from './watch.js';

export function mountWebSocket(httpServer: Server, watcher: FileWatcher): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  watcher.on('change', (type: ChangeType) => {
    const message = JSON.stringify({ type });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  });

  // Inbound messages are intentionally ignored — this channel is broadcast-only.
  wss.on('connection', (socket) => {
    socket.on('message', () => {});
  });

  return wss;
}
