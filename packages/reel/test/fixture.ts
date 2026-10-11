import type { EvidenceRef, LineTiming, Storyboard } from '@dailies/core';

const entry = (entryId: string): EvidenceRef[] => [{ type: 'entry', entryId }];

const HUNK = `@@ -41,9 +41,14 @@ export class Queue {
   async run(job: Job) {
     try {
       await this.handler(job);
-    } catch (err) {
-      this.failed.push(job);
+    } catch (err) {
+      if (job.attempts < this.maxAttempts) {
+        job.attempts += 1;
+        await sleep(backoff(job.attempts));
+        return this.run(job);
+      }
+      this.failed.push({ ...job, error: String(err) });
     }
   }
 }`;

/** One scene of each type, in the order the pipeline produces them. */
export function fixtureStoryboard(): Storyboard {
  return {
    runId: 'run_fixture',
    repo: 'acme/retry-queue',
    targetSec: 75,
    facts: { 'sessions.count': 2, 'commits.count': 3, 'files.count': 5, 'turns.total': 41, 'tools.calls': 128, 'duration.minutes': 96 },
    scenes: [
      { id: 'sc_title', type: 'title', lines: [], repo: 'acme/retry-queue', windowLabel: 'Last 7 days', sessionCount: 2, commitCount: 3 },
      {
        id: 'sc_prompt', type: 'prompt', sessionId: 's1', entryId: 's1:0',
        quote: 'The queue drops jobs when the worker restarts. Add a retry with backoff and make sure nothing is lost on shutdown.',
        lines: [{ id: 'l1', text: 'The session opened with a request to stop losing jobs on restart.', evidence: entry('s1:0') }],
      },
      {
        id: 'sc_terminal', type: 'terminal',
        steps: [
          {
            command: 'pnpm vitest run test/queue.test.ts',
            output: ' FAIL  test/queue.test.ts > retries a failed job\nAssertionError: expected 1 to be 3\n\n Test Files  1 failed (1)\n      Tests  1 failed | 4 passed (5)',
            ok: false, entryId: 's1:14',
          },
          {
            command: 'pnpm vitest run test/queue.test.ts',
            output: ' PASS  test/queue.test.ts (5 tests) 212ms\n\n Test Files  1 passed (1)\n      Tests  5 passed (5)',
            ok: true, entryId: 's1:22',
          },
        ],
        lines: [
          { id: 'l2', text: 'The first test run failed on the retry count.', evidence: entry('s1:14') },
          { id: 'l3', text: 'After the change, all five tests passed.', evidence: entry('s1:22') },
        ],
      },
      {
        id: 'sc_diff', type: 'diff', sha: '3f9c2ab71d0e4c55', path: 'src/queue.ts', hunk: HUNK, added: 7, removed: 2,
        lines: [{ id: 'l4', text: 'The retry lives in the run method of the queue.', evidence: [{ type: 'diff', sha: '3f9c2ab71d0e4c55', path: 'src/queue.ts' }] }],
      },
      {
        id: 'sc_stats', type: 'stats',
        items: [
          { label: 'Sessions', value: '2', statKey: 'sessions.count' },
          { label: 'Commits', value: '3', statKey: 'commits.count' },
          { label: 'Files touched', value: '5', statKey: 'files.count' },
          { label: 'Turns', value: '41', statKey: 'turns.total' },
          { label: 'Tool calls', value: '128', statKey: 'tools.calls' },
          { label: 'Minutes', value: '96', statKey: 'duration.minutes' },
        ],
        lines: [{ id: 'l5', text: 'Two sessions produced three commits across five files.', evidence: [{ type: 'stat', key: 'sessions.count' }] }],
      },
      {
        id: 'sc_flag', type: 'flag', claimId: 'c_7', verdict: 'contradicted',
        quote: 'All tests pass and the build is green.',
        reality: 'The last test run before that message had failed.',
        lines: [
          { id: 'l6', text: 'The agent wrote: "All tests pass and the build is green."', evidence: entry('s2:31') },
          { id: 'l7', text: 'The last test run before that message had failed.', evidence: entry('s2:29') },
        ],
      },
      { id: 'sc_end', type: 'end', lines: [], repo: 'acme/retry-queue', verified: 4, flagged: 1 },
    ],
  };
}

/** Contiguous timings for the seven lines of `fixtureStoryboard`, 24.6 s of narration. */
export function fixtureTimings(): LineTiming[] {
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

/** Title, one prompt scene with a single line, end. */
export function shortStoryboard(): Storyboard {
  const sb = fixtureStoryboard();
  return { ...sb, scenes: [sb.scenes[0]!, sb.scenes[1]!, sb.scenes.at(-1)!] };
}
