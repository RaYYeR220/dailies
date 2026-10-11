import { getRun, listEvents } from '@dailies/pipeline/runtime';
import type { Database } from '@dailies/pipeline/runtime';

const POLL_MS = 1000;

export function createEventStream(
  db: Database,
  runId: string,
  afterId: number,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let lastId = afterId;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };

      const tick = () => {
        if (signal.aborted) {
          stop();
          return;
        }

        let status: string;
        try {
          for (const event of listEvents(db, runId, lastId)) {
            lastId = event.id;
            controller.enqueue(encoder.encode(`id: ${event.id}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`));
          }
          status = getRun(db, runId).status;
        } catch (err) {
          stop();
          controller.error(err);
          return;
        }

        if (status !== 'running') {
          controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
          stop();
          controller.close();
          return;
        }

        timer = setTimeout(tick, POLL_MS);
      };

      signal.addEventListener('abort', () => {
        stop();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      tick();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  });
}
