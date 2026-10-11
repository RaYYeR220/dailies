import { describe, expect, it } from 'vitest';
import { normalize, quoteMatches } from '../src/index';

describe('normalize', () => {
  it('collapses whitespace and strips markdown emphasis marks', () => {
    expect(normalize('  **bold**  _em_ `code`  spread   out ')).toBe('bold em code spread out');
  });
});

describe('quoteMatches', () => {
  it('matches a quote that differs by whitespace and Markdown marks, rejects a missing quote', () => {
    expect(quoteMatches('All tests pass now', 'Done. **All tests\n pass** now.')).toBe(true);
    expect(quoteMatches('All tests pass', 'I did not run the tests.')).toBe(false);
  });
});
