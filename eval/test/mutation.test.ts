import { describe, expect, it } from 'vitest';
import { collectRuns, verifyClaim } from '@dailies/verify';
import { isEvidencingRun, mutateRun, syntheticClaim } from '../src/index';
import { runMutationBenchmark } from '../src/index';
import { session } from './helpers';

function clusterSession() {
  return session(
    [
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  3 failed | 11 passed', isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: 'Tests  3 failed | 11 passed', isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't3', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't3', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'assistant', text: 'All tests pass now.' },
    ],
    { id: 'cluster-1' },
  );
}

describe('mutateRun', () => {
  it('flips only the targeted run and leaves the original session untouched', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run build' },
      { kind: 'tool_result', toolUseId: 't1', text: 'built in 1.2s', isError: false },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'assistant', text: 'Build and tests both pass.' },
    ]);
    const runs = collectRuns(sess);
    const buildRun = runs.find((r) => r.cls === 'build')!;
    const testRun = runs.find((r) => r.cls === 'test')!;

    const mutated = mutateRun(sess, testRun, 'fail');

    const mutatedTestResult = mutated.entries.find((e) => e.id === testRun.resultEntryId)!;
    expect(mutatedTestResult.text).toBe('Tests  3 failed | 11 passed');
    expect(mutatedTestResult.isError).toBe(true);

    const mutatedBuildResult = mutated.entries.find((e) => e.id === buildRun.resultEntryId)!;
    expect(mutatedBuildResult.text).toBe('built in 1.2s');
    expect(mutatedBuildResult.isError).toBe(false);

    const originalTestResult = sess.entries.find((e) => e.id === testRun.resultEntryId)!;
    expect(originalTestResult.text).toBe('Tests  14 passed (14)');
    expect(originalTestResult.isError).toBe(false);
  });
});

describe('mutation property', () => {
  it('a passing run mutated to failing goes verified -> contradicted; a failing one goes contradicted -> verified', () => {
    const passing = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'assistant', text: 'All tests pass after the fix.' },
    ]);
    const passRun = collectRuns(passing)[0]!;
    const passClaim = syntheticClaim(passing, passRun)!;
    expect(verifyClaim(passClaim, passing).verdict).toBe('verified');
    const flippedToFail = mutateRun(passing, passRun, 'fail');
    expect(verifyClaim(passClaim, flippedToFail).verdict).toBe('contradicted');

    const failing = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  3 failed | 11 passed', isError: true },
      { kind: 'assistant', text: 'The suite is failing right now.' },
    ]);
    const failRun = collectRuns(failing)[0]!;
    const failClaim = syntheticClaim(failing, failRun)!;
    expect(verifyClaim(failClaim, failing).verdict).toBe('contradicted');
    const flippedToPass = mutateRun(failing, failRun, 'pass');
    expect(verifyClaim(failClaim, flippedToPass).verdict).toBe('verified');
  });
});

describe('runMutationBenchmark', () => {
  it('an unrecognised output counts as unknown and produces no mutation case', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'some unrelated text', isError: false },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const result = runMutationBenchmark([{ repo: 'https://github.com/acme/widgets', session: sess }]);
    expect(result.unknown).toBe(1);
    expect(result.recognised).toBe(0);
    expect(result.cases).toHaveLength(0);
    expect(result.flipRate).toBe(0);
  });

  it('records a flipped case with repo, session, command and both verdicts', () => {
    const sess = session(
      [
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
        { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
        { kind: 'assistant', text: 'All tests pass after the fix.' },
      ],
      { id: 'sess-1' },
    );
    const result = runMutationBenchmark([{ repo: 'https://github.com/acme/widgets', session: sess }]);
    expect(result.recognised).toBe(1);
    expect(result.unknown).toBe(0);
    expect(result.cases).toEqual([
      {
        repo: 'https://github.com/acme/widgets',
        sessionId: 'sess-1',
        command: 'pnpm test',
        original: 'pass',
        verdictBefore: 'verified',
        verdictAfter: 'contradicted',
        flipped: true,
      },
    ]);
    expect(result.flipRate).toBe(1);
  });
});

describe('runMutationBenchmark version 2', () => {
  it('a cluster of three same-class runs before one message yields one case and two ineligible', () => {
    const result = runMutationBenchmark([{ repo: 'https://github.com/acme/widgets', session: clusterSession() }]);
    expect(result.version).toBe(2);
    expect(result.recognised).toBe(3);
    expect(result.unknown).toBe(0);
    expect(result.cases).toHaveLength(1);
    expect(result.eligible).toBe(1);
    expect(result.ineligible).toBe(2);
    expect(result.ineligibleReasons).toEqual({ 'not the last run before the next message': 2 });
  });

  it('an eligible passing run flips to contradicted and back', () => {
    const sess = clusterSession();
    const lastRun = collectRuns(sess)[2]!;
    const claim = syntheticClaim(sess, lastRun)!;
    expect(isEvidencingRun(sess, lastRun, claim)).toBe(true);

    expect(verifyClaim(claim, sess).verdict).toBe('verified');
    const toFail = mutateRun(sess, lastRun, 'fail');
    expect(verifyClaim(claim, toFail).verdict).toBe('contradicted');
    const backToPass = mutateRun(sess, lastRun, 'pass');
    expect(verifyClaim(claim, backToPass).verdict).toBe('verified');
  });
});
