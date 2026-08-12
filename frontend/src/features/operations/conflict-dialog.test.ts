import { describe, expect, it } from 'vitest';
import { formatConflictMetadata } from './conflict-dialog';

describe('formatConflictMetadata', () => {
  it('uses compact bytes and second-precision timestamps', () => {
    expect(
      formatConflictMetadata({
        name: 'locations.md',
        size: 1648,
        modifiedAt: '2026-07-30T14:17:06.901716538Z',
        kind: 'file',
      }),
    ).toBe('locations.md · 1648b · 2026-07-30 14:17:06');
  });
});
