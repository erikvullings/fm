import m from 'mithril';
import type { ComparisonStatus } from '../../models';
import type { DirectoryColumnDescriptor } from '../directory-table/directory-table';
import { isParentEntry } from '../panes/parent-entry';

/** Which side of an active comparison a pane represents. */
export type ComparisonSide = 'left' | 'right';

const BADGE_TEXT: Record<Exclude<ComparisonStatus, 'identical'>, string> = {
  onlyLeft: 'only here',
  onlyRight: 'only here',
  newer: 'newer',
  older: 'older',
  differentSize: 'size ≠',
  typeMismatch: 'type ≠',
};

const BADGE_TITLE: Record<Exclude<ComparisonStatus, 'identical'>, string> = {
  onlyLeft: 'Present only in this pane',
  onlyRight: 'Present only in this pane',
  newer: 'More recently modified than the other pane',
  older: 'Less recently modified than the other pane',
  differentSize: 'Differs from the other pane',
  typeMismatch: 'A file on one side, a directory on the other',
};

/** Renders one entry's comparison outcome as a non-colour-only text badge (spec §29): every
 * status has its own label and a full description in `title`, so it reads correctly without
 * relying on colour alone. `side` flips `newer`/`older` so each pane always describes itself
 * relative to the other, rather than repeating the same (left-relative) backend wording twice. */
export function comparisonStatusBadge(status: ComparisonStatus, side: ComparisonSide): m.Children {
  if (status === 'identical') return '';
  const displayStatus =
    side === 'right' && status === 'newer'
      ? 'older'
      : side === 'right' && status === 'older'
        ? 'newer'
        : status;
  return m(
    'span.fm-comparison-badge',
    { title: BADGE_TITLE[status], 'aria-label': BADGE_TITLE[status] },
    BADGE_TEXT[displayStatus],
  );
}

/** Declarative column showing each entry's comparison outcome, added to a pane's `pluginColumns`
 * only while it is part of an active comparison (task 0075). `lookup` closes over the pane's live
 * comparison state, so the column always reflects the latest streamed batch without the column
 * descriptor itself needing to change identity every render. */
export function comparisonStatusColumn(
  side: ComparisonSide,
  lookup: (entryLocationUri: string) => ComparisonStatus | undefined,
): DirectoryColumnDescriptor {
  return {
    id: 'core.comparisonStatus',
    label: 'Compare',
    cellClass: 'fm-directory-comparison-status',
    render: (entry) => {
      if (isParentEntry(entry.id)) return '';
      const status = lookup(entry.location.uri);
      if (status === undefined) return '';
      return comparisonStatusBadge(status, side);
    },
  };
}
