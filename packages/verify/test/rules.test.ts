import { describe, expect, it } from 'vitest';
import { verifyClaim, verifyClaims } from '../src/index';
import { claim, session } from './helpers';

describe('tests_pass', () => {
  it('is contradicted when the last run failed', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'FAIL tests/x.test.ts\n2 failed | 10 passed', isError: true },
      { kind: 'assistant', text: 'All tests pass now.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: 'All tests pass now.', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('contradicted');
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        { type: 'entry', entryId: sess.entries[0]!.id },
        { type: 'entry', entryId: sess.entries[1]!.id },
      ])
    );
  });

  it('is verified when the last run passed and nothing was edited after it', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Test Files 1 passed\nTests 14 passed', isError: false },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    expect(verifyClaim(c, sess).verdict).toBe('verified');
  });

  it('is stale when a source file was edited after the last passing run', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests 14 passed', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'src/foo.ts' },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[3]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('stale');
    expect(result.evidence).toEqual(expect.arrayContaining([{ type: 'entry', entryId: sess.entries[2]!.id }]));
  });

  it('ignores an edit to a .md file', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests 14 passed', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'README.md' },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[3]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    expect(verifyClaim(c, sess).verdict).toBe('verified');
  });

  it('is unverifiable when no run exists, and when the output is unrecognised', () => {
    const noRun = session([{ kind: 'assistant', text: 'All tests pass.' }]);
    const noRunClaim = claim({ sessionId: 's1', entryId: noRun.entries[0]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    const noRunResult = verifyClaim(noRunClaim, noRun);
    expect(noRunResult.verdict).toBe('unverifiable');
    expect(noRunResult.reason).toBe('no test run is recorded before this message');

    const unknownOutput = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'some unrelated text', isError: false },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const unknownClaim = claim({
      sessionId: 's1',
      entryId: unknownOutput.entries[2]!.id,
      quote: 'All tests pass.',
      kind: 'tests_pass',
    });
    expect(verifyClaim(unknownClaim, unknownOutput).verdict).toBe('unverifiable');
  });
});

describe('build_passes', () => {
  it('is verified over a passing build run, and also covers lint runs', () => {
    const buildSess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run build' },
      { kind: 'tool_result', toolUseId: 't1', text: 'built in 1.2s', isError: false },
      { kind: 'assistant', text: 'The build passes.' },
    ]);
    const buildClaim = claim({
      sessionId: 's1',
      entryId: buildSess.entries[2]!.id,
      quote: 'The build passes.',
      kind: 'build_passes',
    });
    expect(verifyClaim(buildClaim, buildSess).verdict).toBe('verified');

    const lintSess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run lint' },
      { kind: 'tool_result', toolUseId: 't1', text: '3 problems', isError: false },
      { kind: 'assistant', text: 'The build passes.' },
    ]);
    const lintClaim = claim({
      sessionId: 's1',
      entryId: lintSess.entries[2]!.id,
      quote: 'The build passes.',
      kind: 'build_passes',
    });
    expect(verifyClaim(lintClaim, lintSess).verdict).toBe('contradicted');
  });
});

describe('ran_command', () => {
  it('is unverifiable when the command is absent and contradicted when it errored', () => {
    const absent = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'assistant', text: 'I deployed the app.' },
    ]);
    const absentClaim = claim({
      sessionId: 's1',
      entryId: absent.entries[1]!.id,
      quote: 'I deployed the app.',
      kind: 'ran_command',
      subject: 'pnpm run deploy',
    });
    expect(verifyClaim(absentClaim, absent).verdict).toBe('unverifiable');

    const errored = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run deploy' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Error: deploy failed', isError: true },
      { kind: 'assistant', text: 'I deployed the app.' },
    ]);
    const erroredClaim = claim({
      sessionId: 's1',
      entryId: errored.entries[2]!.id,
      quote: 'I deployed the app.',
      kind: 'ran_command',
      subject: 'pnpm run deploy',
    });
    expect(verifyClaim(erroredClaim, errored).verdict).toBe('contradicted');
  });

  it('is verified when the matching command succeeded', () => {
    const ok = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run deploy' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Deployed to production', isError: false },
      { kind: 'assistant', text: 'I deployed the app.' },
    ]);
    const okClaim = claim({
      sessionId: 's1',
      entryId: ok.entries[2]!.id,
      quote: 'I deployed the app.',
      kind: 'ran_command',
      subject: 'pnpm run deploy',
    });
    expect(verifyClaim(okClaim, ok).verdict).toBe('verified');
  });
});

describe('fixed_error', () => {
  it('is verified only when a later run of the same class lacks the error text', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'assistant', text: "I fixed the 'foo' module error." },
    ]);
    const stillBroken = claim({
      sessionId: 's1',
      entryId: sess.entries[4]!.id,
      quote: "I fixed the 'foo' module error.",
      kind: 'fixed_error',
      subject: "Cannot find module 'foo'",
    });
    expect(verifyClaim(stillBroken, sess).verdict).toBe('contradicted');

    const fixed = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: 'Tests 14 passed', isError: false },
      { kind: 'assistant', text: "I fixed the 'foo' module error." },
    ]);
    const fixedClaim = claim({
      sessionId: 's1',
      entryId: fixed.entries[4]!.id,
      quote: "I fixed the 'foo' module error.",
      kind: 'fixed_error',
      subject: "Cannot find module 'foo'",
    });
    expect(verifyClaim(fixedClaim, fixed).verdict).toBe('verified');
  });

  it('is unverifiable when the error text was never recorded, or no later run exists', () => {
    const neverErrored = session([{ kind: 'assistant', text: 'I fixed the parsing bug.' }]);
    const neverClaim = claim({
      sessionId: 's1',
      entryId: neverErrored.entries[0]!.id,
      quote: 'I fixed the parsing bug.',
      kind: 'fixed_error',
      subject: 'parsing bug',
    });
    expect(verifyClaim(neverClaim, neverErrored).verdict).toBe('unverifiable');

    const noLaterRun = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'assistant', text: "I fixed the 'foo' module error." },
    ]);
    const noLaterClaim = claim({
      sessionId: 's1',
      entryId: noLaterRun.entries[2]!.id,
      quote: "I fixed the 'foo' module error.",
      kind: 'fixed_error',
      subject: "Cannot find module 'foo'",
    });
    expect(verifyClaim(noLaterClaim, noLaterRun).verdict).toBe('unverifiable');
  });

  it('is unverifiable, not verified, when the later run has no recorded result', () => {
    const noResult = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'assistant', text: "I fixed the 'foo' module error." },
    ]);
    const c = claim({
      sessionId: 's1',
      entryId: noResult.entries[3]!.id,
      quote: "I fixed the 'foo' module error.",
      kind: 'fixed_error',
      subject: "Cannot find module 'foo'",
    });
    expect(verifyClaim(c, noResult).verdict).toBe('unverifiable');
  });

  it('is unverifiable, not verified, when the later run output is unrecognised', () => {
    const unknownOutput = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: 'some unrelated text', isError: false },
      { kind: 'assistant', text: "I fixed the 'foo' module error." },
    ]);
    const c = claim({
      sessionId: 's1',
      entryId: unknownOutput.entries[4]!.id,
      quote: "I fixed the 'foo' module error.",
      kind: 'fixed_error',
      subject: "Cannot find module 'foo'",
    });
    expect(verifyClaim(c, unknownOutput).verdict).toBe('unverifiable');
  });

  it('is contradicted, not unverifiable, when the later output is unrecognised but still contains the error', () => {
    const stillThere = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: "FAIL Cannot find module 'foo'", isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: "still seeing: Cannot find module 'foo'", isError: false },
      { kind: 'assistant', text: "I fixed the 'foo' module error." },
    ]);
    const c = claim({
      sessionId: 's1',
      entryId: stillThere.entries[4]!.id,
      quote: "I fixed the 'foo' module error.",
      kind: 'fixed_error',
      subject: "Cannot find module 'foo'",
    });
    expect(verifyClaim(c, stillThere).verdict).toBe('contradicted');
  });
});

describe('empty or whitespace-only subject', () => {
  it('ran_command is unverifiable rather than matching every command', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run deploy' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Deployed', isError: false },
      { kind: 'assistant', text: 'I did the thing.' },
    ]);
    const c = claim({
      sessionId: 's1',
      entryId: sess.entries[2]!.id,
      quote: 'I did the thing.',
      kind: 'ran_command',
      subject: '   ',
    });
    expect(verifyClaim(c, sess).verdict).toBe('unverifiable');
  });

  it('fixed_error is unverifiable rather than matching every tool result', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'FAIL something broke', isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: 'Tests 14 passed', isError: false },
      { kind: 'assistant', text: 'I fixed it.' },
    ]);
    const c = claim({
      sessionId: 's1',
      entryId: sess.entries[4]!.id,
      quote: 'I fixed it.',
      kind: 'fixed_error',
      subject: '   ',
    });
    expect(verifyClaim(c, sess).verdict).toBe('unverifiable');
  });
});

describe('quote safety net', () => {
  it('is unverifiable with a fixed reason when the quote is not in the entry', () => {
    const sess = session([{ kind: 'assistant', text: 'Something else entirely.' }]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[0]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('unverifiable');
    expect(result.reason).toBe('quote not found in transcript');
  });

  it('leaves an implemented claim untouched', () => {
    const sess = session([{ kind: 'assistant', text: 'Added the retry helper.' }]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[0]!.id, quote: 'Added the retry helper.', kind: 'implemented' });
    expect(verifyClaim(c, sess)).toEqual(c);
  });
});

describe('mutation property', () => {
  it('flipping a passing result to failing flips verified to contradicted, and back', () => {
    const build = (outcomeText: string, isError: boolean) =>
      session([
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
        { kind: 'tool_result', toolUseId: 't1', text: outcomeText, isError },
        { kind: 'assistant', text: 'All tests pass.' },
      ]);

    const passing = build('Tests 14 passed', false);
    const c = claim({ sessionId: 's1', entryId: passing.entries[2]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    expect(verifyClaim(c, passing).verdict).toBe('verified');

    const failing = build('FAIL\n2 failed', true);
    expect(verifyClaim(c, failing).verdict).toBe('contradicted');

    const passingAgain = build('Tests 14 passed', false);
    expect(verifyClaim(c, passingAgain).verdict).toBe('verified');
  });
});

describe('verifyClaims', () => {
  it('verifies every claim against its own session, and flags a missing session', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests 14 passed', isError: false },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const good = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    const orphan = claim({ id: 'c2', sessionId: 'missing', entryId: 'missing:0', quote: 'x', kind: 'tests_pass' });

    const results = verifyClaims([good, orphan], [sess]);
    expect(results[0]!.verdict).toBe('verified');
    expect(results[1]!.verdict).toBe('unverifiable');
  });
});
