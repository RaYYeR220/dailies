import { afterEach, describe, expect, it } from 'vitest';
import type { Finding, Scene, Storyboard } from '@dailies/core';
import { addCost } from '../../src/index';
import type { GroundArtifact } from '../../src/stages/index';
import { gateStage } from '../../src/stages/gate';
import { cleanup, groundArtifact, harness, twoSessions } from './fixture';

afterEach(cleanup);

const SECRET = `ghp_${'a1B2c3D4e5'.repeat(4)}`;

/** Runs the gate over the grounded fixture storyboard, after `change` has had its way with it. */
async function gate(o: { change?: (storyboard: Storyboard) => void; review?: unknown; spend?: number; recorded?: number; read?: (stage: string) => never } = {}) {
  const ground: GroundArtifact = await groundArtifact();
  o.change?.(ground.storyboard);
  const h = harness({ artifacts: { ingest: twoSessions(), ground, ...(o.review === undefined ? {} : { review: o.review }) } });
  if (o.spend) h.meter.add(o.spend);
  if (o.recorded) addCost(h.db, h.runId, o.recorded);
  const ctx = h.ctx();
  const result = await gateStage(h.deps).run(o.read ? { ...ctx, read: <T>(stage: string): T => (stage === 'review' ? o.read!(stage) : ctx.read<T>(stage as 'ground')) } : ctx);
  const check = (name: string) => result.artifact.checks.find((c) => c.name === name)!;
  return { h, result, checks: result.artifact.checks, check };
}

const sceneOf = <T extends Scene['type']>(storyboard: Storyboard, type: T) => storyboard.scenes.find((s): s is Extract<Scene, { type: T }> => s.type === type)!;
const finding = (o: Partial<Finding> = {}): Finding => ({ sceneId: 'sc_2', issue: 'text overflows the frame', severity: 'high', fix: 'shorten the line', ...o });

describe('gate stage', () => {
  it('gate returns needs_approval when every check passes', async () => {
    const { result, checks, h } = await gate();

    expect(checks).toEqual([
      { name: 'grounding', pass: true, reasons: [] },
      { name: 'secrets', pass: true, reasons: [] },
      { name: 'cost', pass: true, reasons: [] },
      { name: 'review', pass: true, reasons: ['review skipped'] },
    ]);
    expect(result.final).toEqual({ status: 'needs_approval', reason: 'awaiting human approval' });
    expect(result.loopBackTo).toBeUndefined();
    expect(h.calls).toEqual([]);   // the gate is code: no model is asked
  });

  it('gate blocks when a secret-shaped string is on screen', async () => {
    const onScreen = await gate({ change: (sb) => { sceneOf(sb, 'terminal').steps[0]!.output = `Authenticated with ${SECRET}`; } });

    expect(onScreen.result.final).toEqual({ status: 'blocked', reason: 'secrets' });
    expect(onScreen.check('secrets')).toEqual({ name: 'secrets', pass: false, reasons: ['scene sc_3: 1 secret-shaped string'] });
    expect(JSON.stringify(onScreen.result)).not.toContain(SECRET);   // the report must not repeat what it found

    const inHunk = await gate({ change: (sb) => { sceneOf(sb, 'diff').hunk += `\n+const DB_PASSWORD = "correct-horse-battery";`; } });
    expect(inHunk.result.final).toEqual({ status: 'blocked', reason: 'secrets' });
  });

  it('gate blocks when a secret-shaped string is in a narration line', async () => {
    const { result, check } = await gate({ change: (sb) => { sceneOf(sb, 'prompt').lines[0]!.text = `The request included the key ${SECRET}.`; } });

    expect(result.final?.status).toBe('blocked');
    expect(result.final?.reason).toContain('secrets');
    expect(check('secrets').reasons).toEqual(['scene sc_1: 1 secret-shaped string']);
  });

  it('gate blocks when cost exceeds the budget', async () => {
    const over = await gate({ spend: 0.61 });   // the default budget is $0.60 a reel
    expect(over.result.final).toEqual({ status: 'blocked', reason: 'cost' });
    expect(over.check('cost')).toEqual({ name: 'cost', pass: false, reasons: ['spent $0.6100 of a $0.60 budget'] });

    const atLimit = await gate({ spend: 0.6 });
    expect(atLimit.check('cost').pass).toBe(true);
    expect(atLimit.result.final?.status).toBe('needs_approval');
  });

  it('gate counts spend recorded against the run before a restart, when the meter starts again from zero', async () => {
    const { result, check } = await gate({ recorded: 0.75 });

    expect(result.final).toEqual({ status: 'blocked', reason: 'cost' });
    expect(check('cost').reasons).toEqual(['spent $0.7500 of a $0.60 budget']);
  });

  it('gate blocks on a high-severity review finding and passes low ones', async () => {
    const high = await gate({ review: { pass: false, findings: [finding({ severity: 'low', issue: 'short silent gap' }), finding()] } });
    expect(high.result.final).toEqual({ status: 'blocked', reason: 'review' });
    expect(high.check('review')).toEqual({ name: 'review', pass: false, reasons: ['sc_2: text overflows the frame'] });

    const low = await gate({ review: { pass: true, findings: [finding({ severity: 'low', sceneId: null })] } });
    expect(low.check('review')).toEqual({ name: 'review', pass: true, reasons: [] });
    expect(low.result.final?.status).toBe('needs_approval');
  });

  it.each([
    ['is not the shape a review writes', { pass: true, findings: 'none' }],
    ['holds a finding with no severity', { pass: true, findings: [{ sceneId: null, issue: 'x', fix: 'y' }] }],
    ['is not an object', 'looks fine'],
  ])('gate fails closed when the review artifact %s', async (_name, review) => {
    const { result, check } = await gate({ review });

    expect(result.final).toEqual({ status: 'blocked', reason: 'review' });
    expect(check('review').pass).toBe(false);
  });

  it('gate treats only a missing review artifact as a skipped review', async () => {
    const unreadable = await gate({ read: () => { throw new SyntaxError('Unexpected end of JSON input'); } });
    expect(unreadable.result.final).toEqual({ status: 'blocked', reason: 'review' });

    const denied = await gate({ read: () => { throw new Error('EACCES: permission denied'); } });
    expect(denied.result.final).toEqual({ status: 'blocked', reason: 'review' });
  });

  it('gate blocks when a line in the final storyboard has evidence that does not resolve', async () => {
    const { result, check } = await gate({ change: (sb) => { sceneOf(sb, 'prompt').lines[0]!.evidence = [{ type: 'entry', entryId: 's9:99' }]; } });

    expect(result.final).toEqual({ status: 'blocked', reason: 'grounding' });
    expect(check('grounding')).toEqual({ name: 'grounding', pass: false, reasons: ['sc_1/l1: unknown entry: s9:99'] });
  });

  it('gate blocks when a line has no evidence at all, or a spoken scene has no line', async () => {
    const bare = await gate({ change: (sb) => { sceneOf(sb, 'prompt').lines[0]!.evidence = []; } });
    expect(bare.result.final).toEqual({ status: 'blocked', reason: 'grounding' });

    const mute = await gate({ change: (sb) => { sceneOf(sb, 'stats').lines = []; } });
    expect(mute.result.final).toEqual({ status: 'blocked', reason: 'grounding' });
  });

  it('gate blocks on a number the record does not hold, checking stats against the sessions and not the storyboard', async () => {
    const { result, check } = await gate({
      change: (sb) => {
        sb.facts['sessions.count'] = 9;
        sceneOf(sb, 'stats').lines[0]!.text = 'The window holds 9 sessions and 2 commits.';
      },
    });

    expect(result.final).toEqual({ status: 'blocked', reason: 'grounding' });
    expect(check('grounding').reasons).toEqual(['sc_5/l5: number not grounded in evidence: 9']);
  });

  it('gate holds a flag line to its evidence too', async () => {
    const { result, check } = await gate({ change: (sb) => { sceneOf(sb, 'flag').lines[1]!.evidence = [{ type: 'entry', entryId: 's1:99' }]; } });

    expect(result.final).toEqual({ status: 'blocked', reason: 'grounding' });
    expect(check('grounding').reasons).toEqual(['flag_c_1/flag_c_1_reality: unknown entry: s1:99']);
  });

  it('gate names every failed check in the reason and still records the ones that passed', async () => {
    const { result, checks } = await gate({
      spend: 2,
      review: { pass: false, findings: [finding()] },
      change: (sb) => { sceneOf(sb, 'terminal').steps[0]!.command = `curl -H "Authorization: Bearer ${'t0k3n'.repeat(6)}" https://example.com`; },
    });

    expect(result.final).toEqual({ status: 'blocked', reason: 'secrets, cost, review' });
    expect(checks.map((c) => [c.name, c.pass])).toEqual([['grounding', true], ['secrets', false], ['cost', false], ['review', false]]);
  });
});
