import { isIP } from 'node:net';

function first(value: string | null): string | null {
  const ip = value?.split(',')[0]?.trim();
  return ip && isIP(ip) ? ip : null;
}

/**
 * The address a run request is counted against.
 *
 * The service sits behind two proxies. The public address is a Vercel rewrite; the reverse proxy on the host then
 * replaces `x-forwarded-for` with the address it saw, which is Vercel's edge, so every visitor would share a
 * handful of addresses and one person could use up the per-address limit for all. Vercel also sends the visitor's
 * address in `x-vercel-forwarded-for`, which the reverse proxy passes through; that is preferred when present.
 *
 * A caller that reaches the host directly can set that header to anything and so dodge the per-address limit.
 * The per-day limit across all addresses is what bounds that; this value is for fairness, not for security.
 */
export function clientIp(request: Request): string {
  return first(request.headers.get('x-vercel-forwarded-for')) ?? first(request.headers.get('x-forwarded-for')) ?? 'unknown';
}
