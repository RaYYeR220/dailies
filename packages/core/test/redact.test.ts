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
    expect(redact(src)).toEqual({ text: src, hits: 0, homePaths: 0 });
  });

  it('replaces a macOS or Linux home directory with ~, counted apart from secret hits', () => {
    const mac = redact('reading /Users/yehor/Desktop/projects/neathack/README.md');
    expect(mac.text).toBe('reading ~/Desktop/projects/neathack/README.md');
    expect(mac.homePaths).toBe(1);
    expect(mac.hits).toBe(0);

    const linux = redact('writing to /home/runner/work/repo/dist/out.js');
    expect(linux.text).toBe('writing to ~/work/repo/dist/out.js');
    expect(linux.homePaths).toBe(1);
    expect(linux.hits).toBe(0);
  });

  it('replaces a Windows home directory with ~', () => {
    const win = redact('cd C:\\Users\\yehor\\projects\\neathack');
    expect(win.text).toBe('cd ~\\projects\\neathack');
    expect(win.homePaths).toBe(1);
    expect(win.hits).toBe(0);
  });

  it('does not swallow trailing punctuation into the username', () => {
    const r = redact('see /Users/yehor, then check /home/yehor.');
    expect(r.text).toBe('see ~, then check ~.');
    expect(r.homePaths).toBe(2);
  });

  it('redacts dotted, unicode and email-shaped account names in full', () => {
    expect(redact('cd /Users/john.doe/code').text).toBe('cd ~/code');
    expect(redact('cd /home/Єгор/code').text).toBe('cd ~/code');
    expect(redact('cd /home/user@corp.com/code').text).toBe('cd ~/code');
  });

  it('counts several home paths in one string and never touches a secret hit', () => {
    const r = redact('cp /Users/yehor/a.txt /home/yehor/b.txt # TOKEN=aVeryRealSecretValue123');
    expect(r.text).toBe('cp ~/a.txt ~/b.txt # TOKEN=[REDACTED:assignment]');
    expect(r.homePaths).toBe(2);
    expect(r.hits).toBe(1);
  });
});
