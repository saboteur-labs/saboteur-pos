import { randomBytes } from 'crypto';

export function generateId(prefix: 'task' | 'note'): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
