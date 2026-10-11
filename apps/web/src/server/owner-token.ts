import { timingSafeEqual } from 'node:crypto';

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function hasValidOwnerToken(request: Request): boolean {
  const configured = process.env.DAILIES_OWNER_TOKEN;
  const provided = request.headers.get('x-owner-token');
  return !!configured && !!provided && constantTimeEqual(provided, configured);
}
