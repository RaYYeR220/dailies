'use client';

import { useEffect, useRef, useState } from 'react';
import { isRecord, parseGate, parseRun, parseStages } from './parse';
import { mergeEvents, type RunEvent } from './run-model';
import type { Gate, RunInfo, StageInfo } from './types';

const REFRESH_MS = 2000;
const RETRY_MS = [1000, 2000, 5000, 10000];

export type FeedState = 'live' | 'reconnecting' | 'ended';

function parseEvent(data: string): RunEvent | null {
  try {
    const e: unknown = JSON.parse(data);
    if (!isRecord(e) || typeof e.id !== 'number' || typeof e.message !== 'string' || typeof e.ts !== 'string') return null;
    return { id: e.id, ts: e.ts, stage: typeof e.stage === 'string' ? e.stage : null, message: e.message };
  } catch {
    return null;
  }
}

/**
 * A run as it happens. The event log comes over the event stream; the stage rows and the cost do not
 * raise events, so they are re-read from the API while the run is going. The gate's checks are read
 * from the reel endpoint once the gate stage has written them.
 */
export function useRunFeed(initial: { run: RunInfo; stages: StageInfo[] }) {
  const id = initial.run.id;
  const [run, setRun] = useState(initial.run);
  const [stages, setStages] = useState(initial.stages);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [gate, setGate] = useState<Gate | null>(null);
  const [feed, setFeed] = useState<FeedState>('live');
  const lastId = useRef(0);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let gateRead = false;

    async function refresh() {
      try {
        const res = await fetch(`/api/runs/${id}`, { cache: 'no-store' });
        const body: unknown = await res.json();
        const next = isRecord(body) ? parseRun(body.run) : null;
        if (closed || !next) return;
        const rows = parseStages(isRecord(body) ? body.stages : null);
        setRun(next);
        setStages(rows);
        const gateDone = rows.some((s) => s.name === 'gate' && s.status === 'done');
        if (gateDone && !gateRead) {
          const reel = await fetch(`/api/reels/${id}`, { cache: 'no-store' });
          const reelBody: unknown = reel.ok ? await reel.json() : null;
          const checks = isRecord(reelBody) ? parseGate(reelBody.gate) : null;
          if (!closed && checks) {
            gateRead = true;
            setGate(checks);
          }
        }
        if (next.status !== 'running' && poll) {
          clearInterval(poll);
          poll = null;
        }
      } catch {
        // A failed refresh is retried by the next tick; the log shows the connection state.
      }
    }

    function connect() {
      if (closed) return;
      // The browser resends Last-Event-ID when it reconnects by itself. A stream opened by hand after
      // a hard failure has no such header, so it says where to resume in the query.
      source = new EventSource(`/api/runs/${id}/events?after=${lastId.current}`);
      source.onopen = () => {
        failures = 0;
        setFeed('live');
      };
      source.onmessage = (message) => {
        const event = parseEvent(message.data as string);
        if (!event) return;
        lastId.current = Math.max(lastId.current, event.id);
        setEvents((prev) => mergeEvents(prev, [event]));
        void refresh();
      };
      source.addEventListener('done', () => {
        source?.close();
        setFeed('ended');
        void refresh();
      });
      source.onerror = () => {
        if (closed || !source) return;
        setFeed('reconnecting');
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          retry = setTimeout(connect, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
          failures += 1;
        }
      };
    }

    connect();
    void refresh();
    poll = setInterval(refresh, REFRESH_MS);

    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
    };
  }, [id]);

  return { run, stages, events, gate, feed };
}
