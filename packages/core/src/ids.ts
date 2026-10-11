import { randomBytes } from 'node:crypto';
export const entryId = (sessionId: string, index: number) => `${sessionId}:${index}`;
export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
