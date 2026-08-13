import { describe, expect, it } from 'vitest';

import type { ComparisonStatus, EntrySummary } from '../../models';
import { comparisonStatusBadge, comparisonStatusColumn } from './comparison-column';

function entry(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 'entry-1',
    location: { providerId: 'file', uri: 'mock:///report.txt' },
    name: 'report.txt',
    kind: 'file',
    size: 1_024,
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
    ...overrides,
  };
}

function textOf(vnode: unknown): string {
  if (vnode === '' || vnode === null || vnode === undefined) return '';
  const node = vnode as { children?: { children?: unknown }[] };
  const text = node.children?.[0]?.children;
  return typeof text === 'string' ? text : '';
}

describe('comparisonStatusBadge', () => {
  it('renders nothing for identical entries', () => {
    expect(comparisonStatusBadge('identical', 'left')).toBe('');
  });

  it('labels a same-side-only entry "only here" regardless of side', () => {
    expect(textOf(comparisonStatusBadge('onlyLeft', 'left'))).toBe('only here');
    expect(textOf(comparisonStatusBadge('onlyRight', 'right'))).toBe('only here');
  });

  it('shows "newer" on the left and "older" on the right for the same newer pair', () => {
    expect(textOf(comparisonStatusBadge('newer', 'left'))).toBe('newer');
    expect(textOf(comparisonStatusBadge('newer', 'right'))).toBe('older');
  });

  it('shows "older" on the left and "newer" on the right for the same older pair', () => {
    expect(textOf(comparisonStatusBadge('older', 'left'))).toBe('older');
    expect(textOf(comparisonStatusBadge('older', 'right'))).toBe('newer');
  });

  it('labels differentSize and typeMismatch identically on both sides', () => {
    expect(textOf(comparisonStatusBadge('differentSize', 'left'))).toBe('size ≠');
    expect(textOf(comparisonStatusBadge('differentSize', 'right'))).toBe('size ≠');
    expect(textOf(comparisonStatusBadge('typeMismatch', 'left'))).toBe('type ≠');
  });

  it('carries a full description as both title and aria-label, not colour alone', () => {
    const badge = comparisonStatusBadge('onlyLeft', 'left') as {
      attrs: Record<string, string>;
    };
    expect(badge.attrs.title).toBeTruthy();
    expect(badge.attrs['aria-label']).toBe(badge.attrs.title);
  });
});

describe('comparisonStatusColumn', () => {
  it('renders the badge for an entry the lookup resolves', () => {
    const statuses = new Map<string, ComparisonStatus>([['mock:///report.txt', 'newer']]);
    const column = comparisonStatusColumn('left', (uri) => statuses.get(uri));

    const rendered = column.render(entry());
    expect(textOf(rendered)).toBe('newer');
  });

  it('renders nothing for an entry outside the active comparison', () => {
    const column = comparisonStatusColumn('left', () => undefined);
    expect(column.render(entry())).toBe('');
  });

  it('never annotates the synthetic ".." parent entry', () => {
    const statuses = new Map<string, ComparisonStatus>([['mock:///..', 'onlyLeft']]);
    const column = comparisonStatusColumn('left', (uri) => statuses.get(uri));

    const rendered = column.render(
      entry({ id: 'fm:parent:mock:///', location: { providerId: 'file', uri: 'mock:///..' } }),
    );
    expect(rendered).toBe('');
  });
});
