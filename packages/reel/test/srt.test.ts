import { describe, it, expect } from 'vitest';
import { toSrt } from '../src/srt';
import { fixtureStoryboard, fixtureTimings, shortStoryboard } from './fixture';

const sb = fixtureStoryboard();
const timings = fixtureTimings();
const L1 = 'The session opened with a request to stop losing jobs on restart.';

describe('toSrt', () => {
  it('writes SRT cues shifted by the audio offset', () => {
    expect(toSrt(sb, timings, 2.5).split('\n').slice(0, 3)).toEqual(['1', '00:00:02,500 --> 00:00:06,100', sb.scenes[1]!.lines[0]!.text]);
  });

  it('writes one numbered cue per line, separated by a blank line', () => {
    expect(toSrt(shortStoryboard(), [{ lineId: 'l1', startSec: 0, endSec: 3.6 }], 0)).toBe(`1\n00:00:00,000 --> 00:00:03,600\n${L1}\n`);

    const cues = toSrt(sb, timings, 2.5).trimEnd().split('\n\n');
    expect(cues).toHaveLength(7);
    expect(cues[1]).toBe('2\n00:00:06,100 --> 00:00:09,500\nThe first test run failed on the retry count.');
    expect(cues[6]).toBe('7\n00:00:23,500 --> 00:00:27,100\nThe last test run before that message had failed.');
  });

  it('formats hours, minutes and milliseconds', () => {
    expect(toSrt(shortStoryboard(), [{ lineId: 'l1', startSec: 0, endSec: 3.6 }], 3661.001).split('\n')[1]).toBe('01:01:01,001 --> 01:01:04,601');
  });

  it('carries rounded milliseconds into the next second', () => {
    expect(toSrt(shortStoryboard(), [{ lineId: 'l1', startSec: 59.9996, endSec: 61.25 }], 0).split('\n')[1]).toBe('00:01:00,000 --> 00:01:01,250');
  });

  it('orders cues by the storyboard, not by the timings array', () => {
    expect(toSrt(sb, [...timings].reverse(), 2.5)).toBe(toSrt(sb, timings, 2.5));
  });

  it('keeps a cue on one line when the text contains line breaks', () => {
    const broken = shortStoryboard();
    broken.scenes[1]!.lines[0]!.text = 'First half.\n\nSecond   half.';
    expect(toSrt(broken, [{ lineId: 'l1', startSec: 0, endSec: 2 }], 0)).toBe('1\n00:00:00,000 --> 00:00:02,000\nFirst half. Second half.\n');
  });

  it('writes nothing for a storyboard without narration', () => {
    const bare = { ...sb, scenes: [sb.scenes[0]!, sb.scenes.at(-1)!] };
    expect(toSrt(bare, [], 2.5)).toBe('');
  });

  it('throws when a line has no timing', () => {
    expect(() => toSrt(sb, timings.slice(0, 3), 2.5)).toThrow(/no timing for line l4/);
  });
});
