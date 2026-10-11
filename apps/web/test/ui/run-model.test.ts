import { describe, it, expect } from 'vitest';
import { gateFrames, mergeEvents, normalizeRepoInput, reasonInWords, refusalInWords, runHeadline, stageNote } from '../../src/ui/run-model';
import { stageStates } from '../../src/ui/model';

const ev = (id: number, stage: string | null = null, message = `m${id}`) => ({ id, ts: `2026-10-12T00:00:0${id}.000Z`, stage, message });

describe('mergeEvents', () => {
  it('appends new events in id order', () => {
    expect(mergeEvents([ev(1), ev(2)], [ev(3)]).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('drops an event it already has: a reconnect may replay the last one', () => {
    const merged = mergeEvents([ev(1), ev(2)], [ev(2), ev(3)]);
    expect(merged.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('returns the same array when nothing is new, so the log does not re-render', () => {
    const prev = [ev(1), ev(2)];
    expect(mergeEvents(prev, [ev(1)])).toBe(prev);
    expect(mergeEvents(prev, [])).toBe(prev);
  });
});

describe('stageNote', () => {
  it('is the last thing each stage logged', () => {
    const events = [ev(1, 'ingest', '4 sessions'), ev(2, 'verify', '8 claims'), ev(3, 'verify', '6 verified, 1 contradicted'), ev(4, null, 'x')];
    expect(stageNote(events, 'verify')).toBe('6 verified, 1 contradicted');
    expect(stageNote(events, 'ingest')).toBe('4 sessions');
    expect(stageNote(events, 'gate')).toBeNull();
  });
});

describe('gateFrames', () => {
  it('is four unmarked frames until the gate stage reports', () => {
    const frames = gateFrames(null, 0.6);
    expect(frames.map((f) => f.key)).toEqual(['grounding', 'secrets', 'cost', 'review']);
    expect(frames.every((f) => f.state === 'pending' && f.reasons.length === 0)).toBe(true);
    expect(frames[2]!.blurb).toBe('The run stays inside its $0.60 budget.');
  });

  it('marks each frame from the check with its name, whatever the order or the case', () => {
    const frames = gateFrames(
      {
        checks: [
          { name: 'Review', pass: true, reasons: ['review skipped'] },
          { name: 'cost', pass: false, reasons: ['spent $0.71 of $0.60'] },
          { name: 'grounding', pass: true, reasons: [] },
          { name: 'secrets', pass: true, reasons: [] },
        ],
      },
      0.6,
    );
    expect(frames.map((f) => [f.key, f.state])).toEqual([['grounding', 'pass'], ['secrets', 'pass'], ['cost', 'fail'], ['review', 'pass']]);
    expect(frames[2]!.reasons).toEqual(['spent $0.71 of $0.60']);
    expect(frames[3]!.reasons).toEqual(['review skipped']);
  });

  it('leaves a frame unmarked when the gate did not report that check, and adds a check it does not know', () => {
    const frames = gateFrames({ checks: [{ name: 'grounding', pass: true, reasons: [] }, { name: 'licence', pass: false, reasons: ['GPL file'] }] }, 0.6);
    expect(frames.map((f) => [f.key, f.state])).toEqual([
      ['grounding', 'pass'], ['secrets', 'pending'], ['cost', 'pending'], ['review', 'pending'], ['licence', 'fail'],
    ]);
    expect(frames[4]).toMatchObject({ title: 'Licence', blurb: '', reasons: ['GPL file'] });
  });
});

describe('runHeadline', () => {
  const states = (done: number, then?: 'running' | 'failed') =>
    stageStates(
      ['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'review', 'gate'].map((name, i) => ({
        name,
        status: i < done ? 'done' : i === done && then ? then : 'pending',
      })),
    );

  it('counts the running stage of a run in progress', () => {
    expect(runHeadline('running', states(4, 'running'))).toEqual({ lead: 'Reading the night.', strong: 'Stage 5 of 9.' });
  });

  it('says a queued run is waiting for the worker', () => {
    expect(runHeadline('running', states(0))).toEqual({ lead: 'In the queue.', strong: 'Waiting for the worker.' });
  });

  it('counts the next stage between two stages', () => {
    expect(runHeadline('running', states(3))).toEqual({ lead: 'Reading the night.', strong: 'Stage 4 of 9.' });
  });

  it('names the outcome of a run that ended', () => {
    expect(runHeadline('needs_approval', states(9))).toEqual({ lead: 'The cut is ready.', strong: 'Waiting for your review.' });
    expect(runHeadline('blocked', states(9))).toEqual({ lead: 'The run stopped.', strong: 'Blocked at the gate.' });
    expect(runHeadline('blocked', states(1))).toEqual({ lead: 'The run stopped.', strong: 'Blocked at stage 1 of 9.' });
    expect(runHeadline('blocked', states(5, 'running'))).toEqual({ lead: 'The run stopped.', strong: 'Blocked at stage 6 of 9.' });
    expect(runHeadline('failed', states(2, 'failed'))).toEqual({ lead: 'The run stopped.', strong: 'Stage 3 of 9 failed.' });
  });
});

describe('runHeadline without a review stage', () => {
  it('still names the gate when the gate reported and review never ran', () => {
    const states = stageStates(
      ['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'gate'].map((name) => ({ name, status: 'done' })),
    );
    expect(runHeadline('blocked', states).strong).toBe('Blocked at the gate.');
  });
});

describe('reasonInWords', () => {
  it('spells out the reasons the runner records as codes', () => {
    expect(reasonInWords('budget')).toBe('The run reached its cost budget before the reel was finished.');
  });

  it('turns any other reason into a sentence', () => {
    expect(reasonInWords('no agent sessions found in this window')).toBe('No agent sessions found in this window.');
    expect(reasonInWords('Render timed out.')).toBe('Render timed out.');
  });

  it('says so when no reason was recorded', () => {
    expect(reasonInWords(null)).toBe('No reason was recorded.');
    expect(reasonInWords('  ')).toBe('No reason was recorded.');
  });
});

describe('normalizeRepoInput', () => {
  it('accepts a GitHub repository with or without the scheme', () => {
    expect(normalizeRepoInput('github.com/acme/api')).toBe('https://github.com/acme/api');
    expect(normalizeRepoInput('  https://github.com/acme/api.git ')).toBe('https://github.com/acme/api.git');
    expect(normalizeRepoInput('http://github.com/acme/api/')).toBe('https://github.com/acme/api');
    expect(normalizeRepoInput('www.github.com/acme/api')).toBe('https://github.com/acme/api');
  });

  it('is null for anything that is not a GitHub repository address', () => {
    for (const bad of ['', 'acme/api', 'https://gitlab.com/acme/api', 'https://github.com/acme', 'https://github.com/acme/api?tab=readme', 'https://github.com/acme/api/tree/main']) {
      expect(normalizeRepoInput(bad)).toBeNull();
    }
  });
});

describe('refusalInWords', () => {
  it('explains a rate limit without the code', () => {
    expect(refusalInWords(429, { error: 'rate limited', reason: 'rate_limited_ip' })).toBe(
      'This address has started all the runs it can today. Try again tomorrow.',
    );
    expect(refusalInWords(429, { error: 'rate limited', reason: 'rate_limited_global' })).toBe(
      'Dailies has reached its limit of runs for today. Try again tomorrow.',
    );
  });

  it('explains a rejected address', () => {
    expect(refusalInWords(400, { error: 'repoUrl must be https://github.com/<owner>/<repo>' })).toBe(
      'That is not a GitHub repository address. It should look like github.com/owner/repo.',
    );
  });

  it('says what happened for anything else', () => {
    expect(refusalInWords(500, null)).toBe('The server could not start the run (error 500). Try again in a minute.');
  });
});
