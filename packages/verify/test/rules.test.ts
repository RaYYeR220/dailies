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

  it('is unverifiable with the error-exit reason when the last test command errored before reporting any results', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: 'No module named pytest', isError: true },
      { kind: 'assistant', text: 'All offline tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: 'All offline tests pass.', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('unverifiable');
    expect(result.reason).toBe('the last test command exited with an error before reporting results');
  });

  it('is contradicted, not unverifiable, when the errored test command reported a recognised failure', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '2 failed, 8 passed', isError: true },
      { kind: 'assistant', text: 'All offline tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: 'All offline tests pass.', kind: 'tests_pass' });
    expect(verifyClaim(c, sess).verdict).toBe('contradicted');
  });

  it('leaves the claim verified when a data file is written after the last passing run, not an edit to code', () => {
    const yamlSess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '12 passed', isError: false },
      { kind: 'tool_call', toolName: 'Write', toolUseId: 't2', filePath: 'claims.yaml' },
      { kind: 'assistant', text: 'Tests now pass 12/12.' },
    ]);
    const yamlClaim = claim({ sessionId: 's1', entryId: yamlSess.entries[3]!.id, quote: 'Tests now pass 12/12.', kind: 'tests_pass' });
    expect(verifyClaim(yamlClaim, yamlSess).verdict).toBe('verified');

    const evidenceSess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '12 passed', isError: false },
      { kind: 'tool_call', toolName: 'Write', toolUseId: 't2', filePath: 'evidence/run.md' },
      { kind: 'assistant', text: 'Tests now pass 12/12.' },
    ]);
    const evidenceClaim = claim({ sessionId: 's1', entryId: evidenceSess.entries[3]!.id, quote: 'Tests now pass 12/12.', kind: 'tests_pass' });
    expect(verifyClaim(evidenceClaim, evidenceSess).verdict).toBe('verified');
  });

  it('is stale when a code file is edited after the last passing run', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '12 passed', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'src/desk.py' },
      { kind: 'assistant', text: 'Tests now pass 12/12.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[3]!.id, quote: 'Tests now pass 12/12.', kind: 'tests_pass' });
    expect(verifyClaim(c, sess).verdict).toBe('stale');
  });

  it('quotes the run summary in the contradicted reason, and is not fooled by a failing run that also has a count matching the quote', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '18 failed, 265 passed in 1.10s', isError: false },
      { kind: 'assistant', text: 'All 287 tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: 'All 287 tests pass.', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('contradicted');
    expect(result.reason).toBe('the last test run before this message reported 18 failed, 265 passed');
  });

  it('is unverifiable, not contradicted, when the claim quotes the exact passed count of a run that also failed', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '1 failed, 266 passed, 9 skipped', isError: false },
      { kind: 'assistant', text: '266 Python tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[2]!.id, quote: '266 Python tests pass.', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('unverifiable');
    expect(result.reason).toBe('the run it matches also reported 1 failed');
  });

  it('an edit under a folder named temp inside the source tree still makes the result stale', () => {
    const s = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '4 passed', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'src/temp/handler.py' },
      { kind: 'assistant', text: 'pytest passes (4 passed).' },
    ]);
    const c = claim({ sessionId: 's1', entryId: s.entries[3]!.id, quote: 'pytest passes (4 passed).', kind: 'tests_pass' });
    expect(verifyClaim(c, s).verdict).toBe('stale');
  });

  it('ignores an edit under an operating-system temp path or a scratchpad, but not an edit to real code', () => {
    const scratch1 = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '4 passed', isError: false },
      { kind: 'tool_call', toolName: 'Write', toolUseId: 't2', filePath: 'C:\\Users\\dev\\AppData\\Local\\Temp\\t_h6.py' },
      { kind: 'assistant', text: 'pytest passes (4 passed).' },
    ]);
    const c1 = claim({ sessionId: 's1', entryId: scratch1.entries[3]!.id, quote: 'pytest passes (4 passed).', kind: 'tests_pass' });
    expect(verifyClaim(c1, scratch1).verdict).toBe('verified');

    const scratch2 = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '4 passed', isError: false },
      { kind: 'tool_call', toolName: 'Write', toolUseId: 't2', filePath: 'scratchpad/watch.py' },
      { kind: 'assistant', text: 'pytest passes (4 passed).' },
    ]);
    const c2 = claim({ sessionId: 's1', entryId: scratch2.entries[3]!.id, quote: 'pytest passes (4 passed).', kind: 'tests_pass' });
    expect(verifyClaim(c2, scratch2).verdict).toBe('verified');

    const real = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
      { kind: 'tool_result', toolUseId: 't1', text: '4 passed', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'scripts/run_case.py' },
      { kind: 'assistant', text: 'pytest passes (4 passed).' },
    ]);
    const c3 = claim({ sessionId: 's1', entryId: real.entries[3]!.id, quote: 'pytest passes (4 passed).', kind: 'tests_pass' });
    expect(verifyClaim(c3, real).verdict).toBe('stale');
  });

  it('ignores an edit under an absolute temp path, on both unix and windows forms', () => {
    const paths = ['/tmp/scratch.py', '/private/tmp/scratch.py', '/var/folders/zz/scratch.py', 'C:\\Users\\dev\\AppData\\Local\\Temp\\scratch.py'];
    for (const filePath of paths) {
      const sess = session([
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pytest' },
        { kind: 'tool_result', toolUseId: 't1', text: '4 passed', isError: false },
        { kind: 'tool_call', toolName: 'Write', toolUseId: 't2', filePath },
        { kind: 'assistant', text: 'pytest passes (4 passed).' },
      ]);
      const c = claim({ sessionId: 's1', entryId: sess.entries[3]!.id, quote: 'pytest passes (4 passed).', kind: 'tests_pass' });
      expect(verifyClaim(c, sess).verdict).toBe('verified');
    }
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

describe('tests_pass: results the session did not record', () => {
  it('does not contradict a claim made after the checks of a pull request were read', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'python -m pytest -q' },
      { kind: 'tool_result', toolUseId: 't1', text: '1 failed, 296 passed, 61 skipped in 23.86s', isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'gh pr checks 43 2>&1 | head' },
      { kind: 'tool_result', toolUseId: 't2', text: 'Tests\tpass\t1m2s\nEntire Gates\tfail\t12s' },
      { kind: 'assistant', text: 'PR #43: merged. Tests passed. Entire Gates failed.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[4]!.id, quote: 'Tests passed', kind: 'tests_pass' });
    const result = verifyClaim(c, sess);
    expect(result.verdict).toBe('unverifiable');
    expect(result.reason).toMatch(/CI result/);
  });

  it('still contradicts when the checks were read before the failing run, not after', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't0', command: 'gh pr checks 43' },
      { kind: 'tool_result', toolUseId: 't0', text: 'Tests\tpass' },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'python -m pytest -q' },
      { kind: 'tool_result', toolUseId: 't1', text: '1 failed, 296 passed in 23.86s', isError: true },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const c = claim({ sessionId: 's1', entryId: sess.entries[4]!.id, quote: 'All tests pass.', kind: 'tests_pass' });
    expect(verifyClaim(c, sess).verdict).toBe('contradicted');
  });

  it('counts an edit to a source file under a Windows path, and ignores one under docs', () => {
    const run = [
      { kind: 'tool_call' as const, toolName: 'Bash', toolUseId: 't1', command: 'python -m pytest -q' },
      { kind: 'tool_result' as const, toolUseId: 't1', text: '314 passed, 64 skipped in 21.83s' },
    ];
    const say = { kind: 'assistant' as const, text: 'Tests pass at 314.' };
    const src = session([...run, { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'D:\\work\\app\\src\\app\\receipt.py' }, say]);
    const docs = session([...run, { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'D:\\work\\app\\docs\\build.py' }, say]);
    const at = (s: typeof src) => claim({ sessionId: 's1', entryId: s.entries[3]!.id, quote: 'Tests pass at 314', kind: 'tests_pass' });
    expect(verifyClaim(at(src), src).verdict).toBe('stale');
    expect(verifyClaim(at(docs), docs).verdict).toBe('verified');
  });
});
