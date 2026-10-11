import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from '../src/app/api/runs/route';
import { GET } from '../src/app/api/runs/[id]/route';

let dataDir: string;

function postRuns(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function getRun(id: string) {
  return GET(new Request(`http://localhost/api/runs/${id}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-runs-'));
  process.env.DAILIES_DATA_DIR = dataDir;
  process.env.DAILIES_RUNS_PER_IP = '2';
  process.env.DAILIES_RUNS_PER_DAY = '3';
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DAILIES_DATA_DIR;
  delete process.env.DAILIES_RUNS_PER_IP;
  delete process.env.DAILIES_RUNS_PER_DAY;
});

describe('POST /api/runs', () => {
  it('rejects non-GitHub and malformed URLs with 400', async () => {
    const nonGithub = await postRuns({ repoUrl: 'https://gitlab.com/octocat/hello-world' });
    expect(nonGithub.status).toBe(400);

    const malformed = await postRuns({ repoUrl: 'not a url' });
    expect(malformed.status).toBe(400);

    const withQuery = await postRuns({ repoUrl: 'https://github.com/octocat/hello-world?tab=readme' });
    expect(withQuery.status).toBe(400);

    const extraSegments = await postRuns({ repoUrl: 'https://github.com/octocat/hello-world/pulls' });
    expect(extraSegments.status).toBe(400);
  });

  it('creates a run and returns 201 with its id', async () => {
    const res = await postRuns({ repoUrl: 'https://github.com/octocat/hello-world.git' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^run_[0-9a-f]+$/);

    const fetched = await getRun(body.runId);
    expect(fetched.status).toBe(200);
    const fetchedBody = (await fetched.json()) as { run: { repoUrl: string } };
    expect(fetchedBody.run.repoUrl).toBe('https://github.com/octocat/hello-world.git');
  });

  it('returns 429 after the per-address limit, and after the global limit', async () => {
    const ip1 = { 'x-forwarded-for': '9.9.9.1' };
    const ip2 = { 'x-forwarded-for': '9.9.9.2' };
    const ip3 = { 'x-forwarded-for': '9.9.9.3' };

    expect((await postRuns({ repoUrl: 'https://github.com/a/a' }, ip1)).status).toBe(201);
    expect((await postRuns({ repoUrl: 'https://github.com/a/a' }, ip1)).status).toBe(201);
    const perIpBlocked = await postRuns({ repoUrl: 'https://github.com/a/a' }, ip1);
    expect(perIpBlocked.status).toBe(429);
    expect(((await perIpBlocked.json()) as { reason: string }).reason).toBe('rate_limited_ip');

    // ip2's first request is the 3rd global request (ip1 used 2 + ip2 uses 1 = 3 = DAILIES_RUNS_PER_DAY).
    expect((await postRuns({ repoUrl: 'https://github.com/a/a' }, ip2)).status).toBe(201);
    const globalBlocked = await postRuns({ repoUrl: 'https://github.com/a/a' }, ip3);
    expect(globalBlocked.status).toBe(429);
    expect(((await globalBlocked.json()) as { reason: string }).reason).toBe('rate_limited_global');
  });
});

describe('GET /api/runs/[id]', () => {
  it('returns stages in pipeline order, 404 for an unknown id', async () => {
    const created = await postRuns({ repoUrl: 'https://github.com/octocat/hello-world' });
    const { runId } = (await created.json()) as { runId: string };

    const res = await getRun(runId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { id: string };
      stages: { name: string; status: string; attempt: number; startedAt: string | null; endedAt: string | null; error: string | null }[];
    };
    expect(body.run.id).toBe(runId);
    expect(body.stages.map((s) => s.name)).toEqual([
      'ingest',
      'edit',
      'verify',
      'script',
      'ground',
      'voice',
      'render',
      'review',
      'gate',
    ]);
    expect(body.stages[0]).toEqual({
      name: 'ingest',
      status: 'pending',
      attempt: 0,
      startedAt: null,
      endedAt: null,
      error: null,
    });

    const missing = await getRun('run_doesnotexist');
    expect(missing.status).toBe(404);
  });
});
