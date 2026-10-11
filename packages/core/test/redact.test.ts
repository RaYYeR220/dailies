import { describe, it, expect } from 'vitest';
import { redact } from '../src/index';

describe('redact', () => {
  it('masks provider keys and keeps the variable name', () => {
    const r = redact('export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345 # ok');
    expect(r.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(r.text).toContain('OPENAI_API_KEY=');
    expect(r.hits).toBeGreaterThan(0);
  });
  it('masks bearer tokens, GitHub tokens, AWS key ids, JWTs and private keys', () => {
    const src = [
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----',
    ].join('\n');
    const r = redact(src);
    for (const s of ['abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'MIIEvQ']) expect(r.text).not.toContain(s);
    expect(r.hits).toBe(5);
  });
  it('leaves git SHAs and ordinary prose alone', () => {
    const src = 'commit 3c66306a912e51b2e07432322d48ad4f63ebce3d fixed the retry loop';
    expect(redact(src)).toEqual({ text: src, hits: 0 });
  });
});
