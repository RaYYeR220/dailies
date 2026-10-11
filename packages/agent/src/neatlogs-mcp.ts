export interface NeatlogsMcp {
  call<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T>;
  searchTraces(a: { query: string; workflowName?: string; dateFrom?: string; limit?: number }): Promise<TraceSummary[]>;
  traceContext(traceId: string): Promise<unknown>;
  analytics(a: { from: string; to: string; workflowName?: string; view?: string }): Promise<unknown>;
}

export interface TraceSummary {
  traceId: string;
  status: string;
  createdAt: string;
  durationMs: number;
  totalTokens: number;
  costUsd: number;
  erroredSpans: number;
  workflowName: string | null;
  inputPreview: string;
  outputPreview: string;
}

export class NeatlogsUnavailableError extends Error {}

interface SearchTracesRow {
  trace_id: string;
  status: string;
  created_at: string;
  duration_ms: number;
  total_tokens: number;
  cost_usd: number;
  errored_span_count: number;
  workflow_name: string | null;
  input_preview: string;
  output_preview: string;
}

const DEFAULT_URL = 'https://ingest.neatlogs.com/mcp';
const PROTOCOL_VERSION = '2025-06-18';
const SEARCH_PREVIEW_CHARS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createNeatlogsMcp(o: { apiKey: string; url?: string; fetchImpl?: typeof fetch }): NeatlogsMcp {
  const url = o.url ?? DEFAULT_URL;
  const fetchImpl = o.fetchImpl ?? fetch;
  let sessionId: string | null = null;
  let initPromise: Promise<void> | null = null;
  let nextId = 2; // id 1 is reserved for the initialize request

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${o.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) h['Mcp-Session-Id'] = sessionId;
    return h;
  }

  async function post(body: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, { method: 'POST', headers: headers(), body });
      } catch (err) {
        throw new NeatlogsUnavailableError(`neatlogs: network error (${(err as Error).message})`);
      }
      if (res.status === 401) throw new NeatlogsUnavailableError('neatlogs: unauthorized');
      if (res.status >= 500) {
        if (attempt < 1) {
          await sleep(1000);
          continue;
        }
        throw new NeatlogsUnavailableError(`neatlogs: server error ${res.status}`);
      }
      if (!res.ok) throw new NeatlogsUnavailableError(`neatlogs: unexpected status ${res.status}`);
      return res;
    }
  }

  async function initialize(): Promise<void> {
    const res = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'dailies', version: '0.1.0' },
        },
      }),
    );
    const sid = res.headers.get('Mcp-Session-Id');
    if (!sid) throw new NeatlogsUnavailableError('neatlogs: no session id returned');
    sessionId = sid;
    await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  }

  function ensureSession(): Promise<void> {
    if (sessionId) return Promise.resolve();
    if (!initPromise) {
      initPromise = initialize().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }

  async function call<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T> {
    await ensureSession();
    const id = nextId++;
    const res = await post(
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }),
    );
    const text = await res.text();
    const dataLine = text.split('\n').find((l) => l.trimStart().startsWith('data:'));
    if (!dataLine) throw new NeatlogsUnavailableError('neatlogs: response had no data line');
    const envelope = JSON.parse(dataLine.trimStart().slice('data:'.length).trim()) as {
      error?: { message?: string };
      result?: { content?: [{ text?: string }] };
    };
    if (envelope.error) throw new NeatlogsUnavailableError(`neatlogs: ${envelope.error.message ?? 'JSON-RPC error'}`);
    const resultText = envelope.result?.content?.[0]?.text;
    if (resultText === undefined) throw new NeatlogsUnavailableError('neatlogs: malformed tool result');
    return JSON.parse(resultText) as T;
  }

  async function searchTraces(a: {
    query: string;
    workflowName?: string;
    dateFrom?: string;
    limit?: number;
  }): Promise<TraceSummary[]> {
    const result = await call<{ total: number; results?: SearchTracesRow[] }>('search_traces', {
      query: a.query,
      workflow_name: a.workflowName,
      date_from: a.dateFrom,
      limit: a.limit,
      preview_chars: SEARCH_PREVIEW_CHARS,
    });
    return (result.results ?? []).map((r) => ({
      traceId: r.trace_id,
      status: r.status,
      createdAt: r.created_at,
      durationMs: r.duration_ms,
      totalTokens: r.total_tokens,
      costUsd: r.cost_usd,
      erroredSpans: r.errored_span_count,
      workflowName: r.workflow_name ?? null,
      inputPreview: r.input_preview,
      outputPreview: r.output_preview,
    }));
  }

  async function traceContext(traceId: string): Promise<unknown> {
    return call('trace_context', { trace_id: traceId });
  }

  async function analytics(a: { from: string; to: string; workflowName?: string; view?: string }): Promise<unknown> {
    return call('analytics', { from: a.from, to: a.to, workflow_name: a.workflowName, view: a.view });
  }

  return { call, searchTraces, traceContext, analytics };
}
