import type { EvidenceRef, LineTiming, Storyboard } from '@dailies/core';

const entry = (entryId: string): EvidenceRef[] => [{ type: 'entry', entryId }];

const HUNK = `@@ -41,8 +41,13 @@ export class Queue {
   async run(job: Job) {
     try {
       await this.handler(job);
     } catch (err) {
-      this.failed.push(job);
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
        id: 'sc_diff', type: 'diff', sha: '3f9c2ab71d0e4c55', path: 'src/queue.ts', hunk: HUNK, added: 6, removed: 1,
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

/** Text of exactly `length` characters that closes with END, so a still shows at a glance whether anything was cut. */
const fill = (phrase: string, length: number) => `${phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length - 4).trimEnd()} END`.padEnd(length, '.');

/** Every field at the limit the schema allows, and the unbounded ones long: the worst case a scene has to lay out. */
export function stressStoryboard(): Storyboard {
  const repo = 'a-rather-long-organisation-name/monorepo-with-a-very-descriptive-name';
  const line = (id: string) => ({ id, text: fill('The narration for this scene runs to the full length a line may have. ', 220), evidence: entry('s1:0') });
  const output = Array.from({ length: 14 }, (_, n) => ` ✓ packages/pipeline/test/stages/stage-${n}.test.ts (12 tests) ${n}ms`).join('\n').slice(0, 600);
  const hunk = ['@@ -120,58 +120,71 @@ export async function runStage(ctx: StageContext, stage: Stage): Promise<StageResult> {']
    .concat(Array.from({ length: 60 }, (_, n) => `${n % 5 === 0 ? '-' : n % 3 === 0 ? '+' : ' '}  const value${n} = await ctx.read('artifact-${n}');`))
    .join('\n').slice(0, 2400);
  return {
    runId: 'run_stress',
    repo,
    targetSec: 75,
    facts: {},
    scenes: [
      { id: 'sc_title', type: 'title', lines: [], repo, windowLabel: '11 September 2026 – 11 October 2026', sessionCount: 128, commitCount: 1047 },
      {
        id: 'sc_prompt', type: 'prompt', sessionId: '0f3a9c21-7b54-4e19-a1c3-5d2e8f6b9a70', entryId: 's1:0',
        quote: fill('Refactor the ingestion pipeline so that every checkpoint is read exactly once, and keep the old behaviour behind a flag. ', 280),
        lines: [line('l1')],
      },
      {
        id: 'sc_terminal', type: 'terminal',
        steps: [true, false, true, false].map((ok, n) => ({
          command: fill(`pnpm --filter @dailies/pipeline exec vitest run --reporter verbose test/stages/stage-${n}.test.ts `, 200), output, ok, entryId: `s1:${n}`,
        })),
        lines: [line('l2')],
      },
      {
        id: 'sc_diff', type: 'diff', sha: '3f9c2ab71d0e4c55a1b2c3d4e5f60718293a4b5c', hunk, added: 148, removed: 97,
        path: 'packages/pipeline/src/stages/some/deeply/nested/directory/structure/with-a-long-file-name.ts',
        lines: [line('l3')],
      },
      {
        id: 'sc_stats', type: 'stats',
        items: Array.from({ length: 6 }, (_, n) => ({ label: fill('Tool calls recorded ', 24), value: `1,234,56${n} tokens`, statKey: `k${n}` })),
        lines: [line('l4')],
      },
      {
        id: 'sc_flag', type: 'flag', claimId: 'c_1', verdict: 'stale',
        quote: fill('Everything is implemented, all of the tests pass and the build is green, so this is ready to merge. ', 240),
        reality: fill('Three source files were edited after the last passing test run, and no run was recorded after those edits. ', 200),
        lines: [line('l5')],
      },
      { id: 'sc_end', type: 'end', lines: [], repo, verified: 128, flagged: 0 },
    ],
  };
}

export function stressTimings(): LineTiming[] {
  return ['l1', 'l2', 'l3', 'l4', 'l5'].map((lineId, n) => ({ lineId, startSec: n * 6, endSec: n * 6 + 6 }));
}
