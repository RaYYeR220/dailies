import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { loadEnv } from '@dailies/core';
import { getDataDir, getDb } from '../../../../server/db';
import { getReel } from '../../../../server/store';
import { mediaFilePath } from '../../../../server/artifacts';
import { RUN_ID_PATTERN, MEDIA_FILES } from '../../../../server/validate';
import { hasValidOwnerToken } from '../../../../server/owner-token';

const CONTENT_TYPES: Record<string, string> = {
  'reel.mp4': 'video/mp4',
  'reel.srt': 'application/x-subrip',
  'poster.png': 'image/png',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await params;
  if (!RUN_ID_PATTERN.test(id) || !MEDIA_FILES.has(file)) {
    return NextResponse.json({ error: 'invalid media request' }, { status: 400 });
  }

  loadEnv();
  const db = getDb();
  const reel = getReel(db, id);
  const hasOwnerToken = hasValidOwnerToken(request);
  const hasCapability = new URL(request.url).searchParams.get('k') === id;
  const approved = reel?.status === 'approved';

  if (!approved && !hasOwnerToken && !hasCapability) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const path = mediaFilePath(getDataDir(), id, file);
  if (!existsSync(path)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const size = statSync(path).size;
  const contentType = CONTENT_TYPES[file] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');

  if (range) {
    const hasStart = range[1] !== '';
    const hasEnd = range[2] !== '';
    let start: number;
    let end: number;
    if (!hasStart) {
      // "bytes=-500" is a suffix range: the last 500 bytes.
      start = Math.max(size - Number(range[2]), 0);
      end = size - 1;
    } else {
      start = Number(range[1]);
      end = hasEnd ? Number(range[2]) : size - 1;
    }
    if (start <= end && end < size) {
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
    },
  });
}
