import { describe, expect, it } from 'vitest';
import { collectRuns } from '@dailies/verify';
import { syntheticClaim } from '../src/synthetic';
import { session } from './helpers';

describe('syntheticClaim', () => {
  it('anchors to the next assistant entry and skips runs followed by a source edit', () => {
    const longText = 'A'.repeat(100);
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'assistant', text: longText },
    ]);
    const run = collectRuns(sess)[0]!;
    const c = syntheticClaim(sess, run);
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('tests_pass');
    expect(c!.sessionId).toBe('s1');
    expect(c!.entryId).toBe(sess.entries[2]!.id);
    expect(c!.quote).toBe('A'.repeat(80));
    expect(c!.quote.length).toBe(80);

    const buildSess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm run build' },
      { kind: 'tool_result', toolUseId: 't1', text: 'built in 1.2s', isError: false },
      { kind: 'assistant', text: 'The build passes.' },
    ]);
    const buildRun = collectRuns(buildSess)[0]!;
    expect(syntheticClaim(buildSess, buildRun)!.kind).toBe('build_passes');

    const editedBetween = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'src/retry.ts' },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const editedRun = collectRuns(editedBetween)[0]!;
    expect(syntheticClaim(editedBetween, editedRun)).toBeNull();

    const mdEditBetween = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't2', filePath: 'README.md' },
      { kind: 'assistant', text: 'All tests pass.' },
    ]);
    const mdEditRun = collectRuns(mdEditBetween)[0]!;
    expect(syntheticClaim(mdEditBetween, mdEditRun)).not.toBeNull();

    const noAssistant = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
    ]);
    const noAssistantRun = collectRuns(noAssistant)[0]!;
    expect(syntheticClaim(noAssistant, noAssistantRun)).toBeNull();
  });
});
