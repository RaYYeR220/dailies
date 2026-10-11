import { createHash } from 'node:crypto';

/** Identifies a repository without naming it: the first 8 hex characters of the SHA-256 of its URL. */
export function repoKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 8);
}
