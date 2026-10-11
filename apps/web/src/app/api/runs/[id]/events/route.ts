import { getDb } from '../../../../../server/db';
import { createEventStream } from '../../../../../server/events-stream';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const url = new URL(request.url);
  const afterId = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? '0') || 0;

  const stream = createEventStream(db, id, afterId, request.signal);

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
