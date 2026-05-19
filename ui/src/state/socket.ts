import { useStore } from './store';

type ChangeType = 'tasks' | 'notes' | 'briefing';

/**
 * Opens a WebSocket connection to /ws and dispatches store refetches on each
 * change event. Reconnects with exponential backoff on unexpected close.
 *
 * Returns a cleanup function that permanently closes the socket.
 */
export function startSocket(): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retryDelay = 1000;

  function connect(): void {
    if (stopped) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.addEventListener('open', () => {
      retryDelay = 1000;
    });

    ws.addEventListener('message', (event: MessageEvent<string>) => {
      let type: ChangeType | undefined;
      try {
        ({ type } = JSON.parse(event.data) as { type: ChangeType });
      } catch {
        return;
      }

      const store = useStore.getState();
      if (type === 'tasks') {
        store.fetchBriefing().catch(() => {});
        store.fetchTasks().catch(() => {});
      } else if (type === 'notes') {
        store.fetchBriefing().catch(() => {});
        store.fetchNotes().catch(() => {});
      } else if (type === 'briefing') {
        store.fetchBriefing().catch(() => {});
      }
    });

    ws.addEventListener('close', () => {
      if (!stopped) {
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    });
  }

  connect();

  return () => {
    stopped = true;
    ws?.close();
  };
}
