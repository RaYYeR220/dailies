import { isIP } from 'node:net';

export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first && isIP(first) ? first : 'unknown';
}
