import { describe, it, expect } from 'vitest';
import { clock, repoName, sentence, shortDate, stamp, windowLabel } from '../../src/ui/format';

describe('clock', () => {
  it('writes seconds as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(27.4)).toBe('0:27');
    expect(clock(74)).toBe('1:14');
    expect(clock(605)).toBe('10:05');
  });

  it('is 0:00 for anything that is not a time', () => {
    expect(clock(-3)).toBe('0:00');
    expect(clock(Number.NaN)).toBe('0:00');
  });
});

describe('stamp', () => {
  it('writes the seconds between two instants as mm:ss', () => {
    expect(stamp('2026-10-12T00:00:00.000Z', '2026-10-12T00:00:35.400Z')).toBe('00:35');
    expect(stamp('2026-10-12T00:00:00.000Z', '2026-10-12T00:12:07.000Z')).toBe('12:07');
  });

  it('is 00:00 when the clock ran backwards or a date is unreadable', () => {
    expect(stamp('2026-10-12T00:00:10.000Z', '2026-10-12T00:00:00.000Z')).toBe('00:00');
    expect(stamp('nope', '2026-10-12T00:00:00.000Z')).toBe('00:00');
  });
});

describe('repoName', () => {
  it('is owner/repo for a GitHub URL', () => {
    expect(repoName('https://github.com/acme/api')).toBe('acme/api');
    expect(repoName('https://github.com/acme/api.git')).toBe('acme/api');
  });

  it('is the address itself for anything else', () => {
    expect(repoName('file:///tmp/repo')).toBe('file:///tmp/repo');
    expect(repoName('/Users/ada/work/acme-api/')).toBe('acme-api');
    expect(repoName('.')).toBe('.');
  });
});

describe('shortDate', () => {
  it('writes a date the same way on the server and in every browser', () => {
    expect(shortDate('2026-10-12T06:10:00.000Z')).toBe('12 Oct 2026');
    expect(shortDate('2026-01-02T23:59:59.000Z')).toBe('2 Jan 2026');
  });

  it('is empty for an unreadable date', () => {
    expect(shortDate('nope')).toBe('');
  });
});

describe('windowLabel', () => {
  it('names the span in days and the day it ends', () => {
    expect(windowLabel('2026-10-05T06:10:00.000Z', '2026-10-12T06:10:00.000Z')).toBe('7 days to 12 Oct 2026');
    expect(windowLabel('2026-10-11T06:10:00.000Z', '2026-10-12T06:10:00.000Z')).toBe('24 hours to 12 Oct 2026');
    expect(windowLabel('2026-10-12T05:10:00.000Z', '2026-10-12T06:10:00.000Z')).toBe('1 hour to 12 Oct 2026');
  });

  it('is empty when the window cannot be read', () => {
    expect(windowLabel('nope', '2026-10-12T06:10:00.000Z')).toBe('');
  });
});

describe('sentence', () => {
  it('capitalises and closes a fragment, and leaves a sentence alone', () => {
    expect(sentence('code was edited after the last passing build')).toBe('Code was edited after the last passing build.');
    expect(sentence('Already a sentence.')).toBe('Already a sentence.');
    expect(sentence('really?')).toBe('Really?');
  });
});
