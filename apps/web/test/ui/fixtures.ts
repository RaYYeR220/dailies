import type { Claim, LineTiming, Storyboard } from '@dailies/core';

/**
 * One night on one repository, the way the pipeline would leave it: a storyboard with one scene of each type,
 * the claims the verify stage judged, and the timings of the seven narration lines. The seed script and the
 * view-model tests both read from here.
 */

export const REPO_URL = 'https://github.com/acme/api';
export const SHA = '8c41f2e0b7a94d13c0de55aa90f1b2c3d4e5f607';

const HUNK = `@@ -18,8 +18,12 @@ export async function send(url: string, body: string) {
-  const res = await fetch(url, { method: 'POST', body });
-  if (!res.ok) throw new Error('webhook failed');
+  for (let attempt = 0; attempt < 4; attempt++) {
+    const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
+    if (res.ok) return;
+    await sleep(250 * 2 ** attempt);
+  }
+  throw new WebhookError(url, 4);
 }`;

export function storyboard(runId = 'run_fixture'): Storyboard {
  return {
    runId,
    repo: 'acme/api',
    targetSec: 75,
    facts: { 'sessions.count': 4, 'commits.count': 9, 'files.count': 11, 'tools.calls': 212, 'duration.minutes': 96 },
    scenes: [
      { id: 'sc_title', type: 'title', lines: [], repo: 'acme/api', windowLabel: 'last night, 23:40 – 06:10', sessionCount: 4, commitCount: 9 },
      {
        id: 'sc_prompt', type: 'prompt', sessionId: 's1', entryId: 's1:1',
        quote: 'Add retry with backoff to the webhook sender, and make sure the tests cover the timeout path.',
        lines: [{ id: 'l1', text: 'The request was a retry with backoff for the webhook sender.', evidence: [{ type: 'entry', entryId: 's1:1' }] }],
      },
      {
        id: 'sc_terminal', type: 'terminal',
        steps: [
          { command: 'pnpm test', output: ' FAIL  test/send.test.ts > retries on a 503\n\n Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 12 passed (14)', ok: false, entryId: 's3:204' },
          { command: 'pnpm test', output: ' Test Files  4 passed (4)\n      Tests  14 passed (14)', ok: true, entryId: 's4:219' },
        ],
        lines: [
          { id: 'l2', text: 'The first test run failed twice.', evidence: [{ type: 'entry', entryId: 's3:204', quote: '2 failed | 12 passed' }] },
          { id: 'l3', text: 'The last run shows 14 tests passing.', evidence: [{ type: 'entry', entryId: 's4:219' }] },
        ],
      },
      {
        id: 'sc_diff', type: 'diff', sha: SHA, path: 'src/webhooks/send.ts', hunk: HUNK, added: 6, removed: 2,
        lines: [
          {
            id: 'l4', text: 'The sender now retries 4 times and waits longer after each attempt.',
            evidence: [
              { type: 'entry', entryId: 's3:209' },
              { type: 'diff', sha: SHA, path: 'src/webhooks/send.ts', quote: 'attempt < 4' },
            ],
          },
        ],
      },
      {
        id: 'sc_stats', type: 'stats',
        items: [
          { label: 'Sessions', value: '4', statKey: 'sessions.count' },
          { label: 'Commits', value: '9', statKey: 'commits.count' },
          { label: 'Tool calls', value: '212', statKey: 'tools.calls' },
          { label: 'Minutes', value: '96', statKey: 'duration.minutes' },
        ],
        lines: [{ id: 'l5', text: 'Four sessions produced nine commits.', evidence: [{ type: 'stat', key: 'sessions.count' }, { type: 'stat', key: 'commits.count' }] }],
      },
      {
        id: 'sc_flag', type: 'flag', claimId: 'c_3', verdict: 'contradicted',
        quote: 'All 14 tests pass.',
        reality: 'The last test run before that message had failed.',
        lines: [
          { id: 'l6', text: 'The agent wrote: "All 14 tests pass."', evidence: [{ type: 'entry', entryId: 's3:212' }] },
          { id: 'l7', text: 'The last test run before that message had failed.', evidence: [{ type: 'entry', entryId: 's3:204' }] },
        ],
      },
      { id: 'sc_end', type: 'end', lines: [], repo: 'acme/api', verified: 5, flagged: 2 },
    ],
  };
}

/** Narration time, not video time: the first line starts at zero. 24.6 s in all. */
export function timings(): LineTiming[] {
  return [
    { lineId: 'l1', startSec: 0, endSec: 3.6 },
    { lineId: 'l2', startSec: 3.6, endSec: 7 },
    { lineId: 'l3', startSec: 7, endSec: 10.2 },
    { lineId: 'l4', startSec: 10.2, endSec: 14 },
    { lineId: 'l5', startSec: 14, endSec: 17.5 },
    { lineId: 'l6', startSec: 17.5, endSec: 21 },
    { lineId: 'l7', startSec: 21, endSec: 24.6 },
  ];
}

const claim = (c: Omit<Claim, 'evidence'> & { evidence?: Claim['evidence'] }): Claim => ({ evidence: [], ...c });

export function claims(): Claim[] {
  return [
    claim({ id: 'c_1', sessionId: 's3', entryId: 's3:209', quote: 'Added the retry loop to send.ts.', kind: 'implemented', verdict: 'verified' }),
    claim({ id: 'c_2', sessionId: 's4', entryId: 's4:220', quote: 'The suite is green now: 14 passed.', kind: 'tests_pass', verdict: 'verified' }),
    claim({
      id: 'c_3', sessionId: 's3', entryId: 's3:212', quote: 'All 14 tests pass.', kind: 'tests_pass', verdict: 'contradicted',
      reason: 'the last test run before this message failed', evidence: [{ type: 'entry', entryId: 's3:204' }],
    }),
    claim({ id: 'c_4', sessionId: 's4', entryId: 's4:226', quote: 'Deployed to staging.', kind: 'ran_command', verdict: 'unverifiable', reason: 'no deploy command is recorded' }),
    claim({ id: 'c_5', sessionId: 's2', entryId: 's2:88', quote: 'The build passes.', kind: 'build_passes', verdict: 'stale', reason: 'code was edited after the last passing build' }),
    claim({ id: 'c_6', sessionId: 's2', entryId: 's2:90', quote: 'Fixed the flaky timeout.', kind: 'fixed_error' }),
  ];
}
