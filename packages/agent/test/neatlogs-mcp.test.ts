import { describe, it, expect, vi } from 'vitest';
import { createNeatlogsMcp, NeatlogsUnavailableError } from '../src/neatlogs-mcp';

type FetchArgs = [string | URL, RequestInit | undefined];

function parsedBody(init: RequestInit | undefined): any {
  return JSON.parse(String(init!.body));
}

function sseBody(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function toolResultBody(id: number, result: unknown): string {
  return sseBody({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
}

function initResponse(sessionId = 'sess-abc'): Response {
  return new Response('', { status: 200, headers: { 'Mcp-Session-Id': sessionId } });
}

function initializedResponse(): Response {
  return new Response('', { status: 202 });
}

describe('createNeatlogsMcp', () => {
  it('initialises once, sends the session id on later calls, and parses the event-stream body', async () => {
    const calls: { body: any; headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (...args: FetchArgs) => {
      const [, init] = args;
      const body = parsedBody(init);
      calls.push({ body, headers: init!.headers as Record<string, string> });
      if (body.method === 'initialize') return initResponse();
      if (body.method === 'notifications/initialized') return initializedResponse();
      if (body.method === 'tools/call') return new Response(toolResultBody(body.id, { ok: true, tool: body.params.name }), { status: 200 });
      throw new Error(`unexpected method ${body.method}`);
    });

    const mcp = createNeatlogsMcp({ apiKey: 'key123', fetchImpl: fetchImpl as unknown as typeof fetch });

    const first = await mcp.call('some_tool', { a: 1 });
    const second = await mcp.call('some_tool', { a: 2 });

    expect(first).toEqual({ ok: true, tool: 'some_tool' });
    expect(second).toEqual({ ok: true, tool: 'some_tool' });

    expect(calls.filter((c) => c.body.method === 'initialize')).toHaveLength(1);
    expect(calls.filter((c) => c.body.method === 'notifications/initialized')).toHaveLength(1);
    expect(calls.filter((c) => c.body.method === 'tools/call')).toHaveLength(2);

    expect(calls[0]!.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dailies', version: '0.1.0' } },
    });
    expect(calls[0]!.headers['Mcp-Session-Id']).toBeUndefined();
    for (const c of calls.slice(1)) {
      expect(c.headers['Mcp-Session-Id']).toBe('sess-abc');
      expect(c.headers.Authorization).toBe('Bearer key123');
    }
  });

  it('maps search_traces rows to TraceSummary and treats a missing results field as empty', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs) => {
      const [, init] = args;
      const body = parsedBody(init);
      if (body.method === 'initialize') return initResponse();
      if (body.method === 'notifications/initialized') return initializedResponse();
      if (body.params.arguments.query === 'has-results') {
        return new Response(
          toolResultBody(body.id, {
            total: 1,
            results: [
              {
                trace_id: 't1',
                status: 'error',
                created_at: '2026-10-01T00:00:00Z',
                duration_ms: 1200,
                total_tokens: 500,
                cost_usd: 0.02,
                errored_span_count: 2,
                workflow_name: 'dailies-reel',
                input_preview: 'in',
                output_preview: 'out',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(toolResultBody(body.id, { total: 0 }), { status: 200 });
    });

    const mcp = createNeatlogsMcp({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    const mapped = await mcp.searchTraces({ query: 'has-results' });
    expect(mapped).toEqual([
      {
        traceId: 't1',
        status: 'error',
        createdAt: '2026-10-01T00:00:00Z',
        durationMs: 1200,
        totalTokens: 500,
        costUsd: 0.02,
        erroredSpans: 2,
        workflowName: 'dailies-reel',
        inputPreview: 'in',
        outputPreview: 'out',
      },
    ]);

    const empty = await mcp.searchTraces({ query: 'no-results' });
    expect(empty).toEqual([]);
  });

  it('raises NeatlogsUnavailableError on 401, on a body without a data line, and on a JSON-RPC error', async () => {
    function makeMcp(toolResponse: () => Response) {
      const fetchImpl = vi.fn(async (...args: FetchArgs) => {
        const [, init] = args;
        const body = parsedBody(init);
        if (body.method === 'initialize') return initResponse();
        if (body.method === 'notifications/initialized') return initializedResponse();
        return toolResponse();
      });
      return createNeatlogsMcp({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    }

    const unauthorized = makeMcp(() => new Response('', { status: 401 }));
    await expect(unauthorized.call('x', {})).rejects.toBeInstanceOf(NeatlogsUnavailableError);

    const noDataLine = makeMcp(() => new Response('not an event stream', { status: 200 }));
    await expect(noDataLine.call('x', {})).rejects.toBeInstanceOf(NeatlogsUnavailableError);

    const rpcError = makeMcp(() =>
      new Response(sseBody({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'boom' } }), { status: 200 }),
    );
    await expect(rpcError.call('x', {})).rejects.toBeInstanceOf(NeatlogsUnavailableError);
  });

  it('raises NeatlogsUnavailableError when the data line or the tool result text is not valid JSON', async () => {
    function makeMcp(toolResponse: () => Response) {
      const fetchImpl = vi.fn(async (...args: FetchArgs) => {
        const [, init] = args;
        const body = parsedBody(init);
        if (body.method === 'initialize') return initResponse();
        if (body.method === 'notifications/initialized') return initializedResponse();
        return toolResponse();
      });
      return createNeatlogsMcp({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    }

    const malformedDataLine = makeMcp(() => new Response('data: {not json\n\n', { status: 200 }));
    await expect(malformedDataLine.call('x', {})).rejects.toBeInstanceOf(NeatlogsUnavailableError);

    const malformedResultText = makeMcp(() =>
      new Response(
        sseBody({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{not json' }] } }),
        { status: 200 },
      ),
    );
    await expect(malformedResultText.call('x', {})).rejects.toBeInstanceOf(NeatlogsUnavailableError);
  });

  it('retries once on 503 and then succeeds', async () => {
    vi.useFakeTimers();
    try {
      let toolAttempts = 0;
      const fetchImpl = vi.fn(async (...args: FetchArgs) => {
        const [, init] = args;
        const body = parsedBody(init);
        if (body.method === 'initialize') return initResponse();
        if (body.method === 'notifications/initialized') return initializedResponse();
        toolAttempts += 1;
        if (toolAttempts === 1) return new Response('', { status: 503 });
        return new Response(toolResultBody(body.id, { ok: true }), { status: 200 });
      });

      const mcp = createNeatlogsMcp({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

      const resultPromise = mcp.call('x', {});
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true });
      expect(toolAttempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
