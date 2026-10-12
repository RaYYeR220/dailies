import { describe, expect, it } from 'vitest';
import { clientIp } from '../src/server/client-ip';

const req = (headers: Record<string, string>) => new Request('http://localhost/api/runs', { headers });

describe('clientIp', () => {
  it('prefers the visitor address the public proxy forwards over the address of the proxy itself', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '76.76.21.21' }))).toBe('203.0.113.7');
  });
  it('falls back to the first forwarded address', () => {
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe('198.51.100.4');
  });
  it('ignores values that are not addresses', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': 'not-an-ip', 'x-forwarded-for': 'also bad' }))).toBe('unknown');
    expect(clientIp(req({}))).toBe('unknown');
  });
});
