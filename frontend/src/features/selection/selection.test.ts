import { describe, expect, it } from 'vitest';

import type { EntryId, EntrySummary, Location } from '../../models';
import {
  emptySelection,
  getSelectedEntries,
  getSelectedEntryLocations,
  reduceSelection,
  type SelectionState,
} from './selection';

const ids = (...values: string[]): readonly EntryId[] => values;

describe('selection reducer', () => {
  it('moves the cursor and selects the new row', () => {
    expect(
      reduceSelection(
        { ...emptySelection, selectedEntryIds: ['b'], cursorEntryId: 'b' },
        { type: 'moveCursor', offset: 1 },
        ids('a', 'b', 'c'),
      ),
    ).toEqual({ selectedEntryIds: ['c'], cursorEntryId: 'c', anchorEntryId: 'c' });
  });

  it('moves by a page and clamps at the list boundary', () => {
    expect(
      reduceSelection(
        { ...emptySelection, cursorEntryId: 'b' },
        { type: 'moveCursor', offset: 20 },
        ids('a', 'b', 'c'),
      ).cursorEntryId,
    ).toBe('c');
  });

  it('moves to the first or last entry', () => {
    const first = reduceSelection(
      { ...emptySelection, cursorEntryId: 'b' },
      { type: 'moveCursorTo', edge: 'first' },
      ids('a', 'b', 'c'),
    );
    expect(first.cursorEntryId).toBe('a');
    expect(
      reduceSelection(first, { type: 'moveCursorTo', edge: 'last' }, ids('a', 'b', 'c'))
        .cursorEntryId,
    ).toBe('c');
  });

  it('selects one entry and establishes a range anchor', () => {
    expect(
      reduceSelection(emptySelection, { type: 'selectOnly', entryId: 'b' }, ids('a', 'b', 'c')),
    ).toEqual({
      selectedEntryIds: ['b'],
      cursorEntryId: 'b',
      anchorEntryId: 'b',
    });
  });

  it('toggles entries into and out of a discontinuous selection', () => {
    const selected = reduceSelection(
      emptySelection,
      { type: 'toggle', entryId: 'a' },
      ids('a', 'b', 'c'),
    );
    const discontinuous = reduceSelection(
      selected,
      { type: 'toggle', entryId: 'c' },
      ids('a', 'b', 'c'),
    );
    expect(discontinuous.selectedEntryIds).toEqual(['a', 'c']);
    expect(
      reduceSelection(discontinuous, { type: 'toggle', entryId: 'a' }, ids('a', 'b', 'c'))
        .selectedEntryIds,
    ).toEqual(['c']);
  });

  it('extends a range from its stable anchor across a sort change', () => {
    const initial: SelectionState = {
      selectedEntryIds: ['b'],
      cursorEntryId: 'b',
      anchorEntryId: 'b',
    };
    const extended = reduceSelection(
      initial,
      { type: 'extendRange', offset: 1 },
      ids('a', 'b', 'c', 'd'),
    );
    expect(extended.selectedEntryIds).toEqual(['b', 'c']);

    expect(
      reduceSelection(extended, { type: 'extendRange', offset: -1 }, ids('d', 'b', 'a', 'c')),
    ).toEqual({
      selectedEntryIds: ['b', 'a'],
      cursorEntryId: 'a',
      anchorEntryId: 'b',
    });
  });

  it('extends a range to a clicked entry and keeps the anchor when clicking back and forth', () => {
    const initial: SelectionState = {
      selectedEntryIds: ['b'],
      cursorEntryId: 'b',
      anchorEntryId: 'b',
    };
    const extended = reduceSelection(
      initial,
      { type: 'extendRangeTo', entryId: 'd' },
      ids('a', 'b', 'c', 'd'),
    );
    expect(extended).toEqual({
      selectedEntryIds: ['b', 'c', 'd'],
      cursorEntryId: 'd',
      anchorEntryId: 'b',
    });

    expect(
      reduceSelection(extended, { type: 'extendRangeTo', entryId: 'a' }, ids('a', 'b', 'c', 'd')),
    ).toEqual({
      selectedEntryIds: ['a', 'b'],
      cursorEntryId: 'a',
      anchorEntryId: 'b',
    });
  });

  it('selects all and inverts the current visible entries', () => {
    const all = reduceSelection(emptySelection, { type: 'selectAll' }, ids('a', 'b', 'c'));
    expect(all.selectedEntryIds).toEqual(['a', 'b', 'c']);
    expect(
      reduceSelection(
        { ...all, selectedEntryIds: ['a', 'c'] },
        { type: 'invert' },
        ids('a', 'b', 'c'),
      ).selectedEntryIds,
    ).toEqual(['b']);
  });

  it('adds matching visible entries without disturbing hidden or existing selections', () => {
    const result = reduceSelection(
      { selectedEntryIds: ['hidden', 'b'] },
      { type: 'selectByMask', matchingEntryIds: ids('c', 'a') },
      ids('a', 'b', 'c'),
    );
    expect(result.selectedEntryIds).toEqual(['a', 'b', 'c', 'hidden']);
  });

  it('removes matching visible entries without disturbing the rest of the selection', () => {
    const result = reduceSelection(
      { selectedEntryIds: ['hidden', 'a', 'b', 'c'] },
      { type: 'deselectByMask', matchingEntryIds: ids('c', 'a') },
      ids('a', 'b', 'c'),
    );
    expect(result.selectedEntryIds).toEqual(['b', 'hidden']);
  });

  it('handles no mask matches and all visible entries matching', () => {
    const initial: SelectionState = { selectedEntryIds: ['hidden', 'b'] };
    expect(
      reduceSelection(initial, { type: 'selectByMask', matchingEntryIds: [] }, ids('a', 'b')),
    ).toEqual(initial);
    expect(
      reduceSelection(
        initial,
        { type: 'selectByMask', matchingEntryIds: ids('a', 'b') },
        ids('a', 'b'),
      ).selectedEntryIds,
    ).toEqual(['a', 'b', 'hidden']);
    expect(
      reduceSelection(
        initial,
        { type: 'deselectByMask', matchingEntryIds: ids('a', 'b') },
        ids('a', 'b'),
      ).selectedEntryIds,
    ).toEqual(['hidden']);
  });

  it('clears selection without moving the cursor', () => {
    expect(
      reduceSelection(
        { selectedEntryIds: ['a'], cursorEntryId: 'a', anchorEntryId: 'a' },
        { type: 'clear' },
        ids('a'),
      ),
    ).toEqual({ selectedEntryIds: [], cursorEntryId: 'a' });
  });

  it('keeps hidden selected ids across filtering and pruning only removes delta ids', () => {
    const state: SelectionState = {
      selectedEntryIds: ['hidden', 'visible', 'removed'],
      cursorEntryId: 'removed',
      anchorEntryId: 'hidden',
    };
    const filtered = reduceSelection(state, { type: 'moveCursor', offset: 1 }, ids('visible'));
    expect(filtered.selectedEntryIds).toEqual(['visible']);

    expect(
      reduceSelection(filtered, { type: 'prune', removedEntryIds: ids('removed') }, ids('visible')),
    ).toEqual({
      selectedEntryIds: ['visible'],
      cursorEntryId: 'visible',
      anchorEntryId: 'visible',
    });
  });
});

function makeEntries(
  ...specs: { id: string; locationUri?: string }[]
): EntrySummary[] {
  return specs.map((s) => ({
    id: s.id as EntryId,
    location: s.locationUri
      ? { providerId: 'local' as never, uri: s.locationUri }
      : ({ providerId: 'local' as never, uri: `/entries/${s.id}` } as Location),
    name: s.id,
    kind: 'file',
    hidden: false,
    readOnly: false,
    metadataRevision: 0,
  }));
}

describe('getSelectedEntries', () => {
  it('returns empty array when selection is undefined', () => {
    const entries = makeEntries({ id: 'a' }, { id: 'b' });
    expect(getSelectedEntries(undefined, entries)).toEqual([]);
  });

  it('returns empty array when selection has no items', () => {
    expect(getSelectedEntries(emptySelection, makeEntries({ id: 'a' }))).toEqual([]);
  });

  it('returns matching entries for single selection', () => {
    const selection: SelectionState = { selectedEntryIds: ['b'] };
    const entries = makeEntries({ id: 'a' }, { id: 'b' }, { id: 'c' });
    expect(getSelectedEntries(selection, entries)).toEqual([entries[1]]);
  });

  it('returns matching entries for discontinuous multi-selection', () => {
    const selection: SelectionState = { selectedEntryIds: ['a', 'c'] };
    const entries = makeEntries({ id: 'a' }, { id: 'b' }, { id: 'c' });
    expect(getSelectedEntries(selection, entries)).toEqual([entries[0], entries[2]]);
  });

  it('returns empty array when selected ids have no overlap with entries', () => {
    const selection: SelectionState = { selectedEntryIds: ['x', 'y'] };
    const entries = makeEntries({ id: 'a' }, { id: 'b' });
    expect(getSelectedEntries(selection, entries)).toEqual([]);
  });

  it('returns empty array when entries list is empty', () => {
    const selection: SelectionState = { selectedEntryIds: ['a'] };
    expect(getSelectedEntries(selection, [])).toEqual([]);
  });

  it('preserves entry order from the directory listing, not selection order', () => {
    const selection: SelectionState = { selectedEntryIds: ['c', 'a'] };
    const entries = makeEntries({ id: 'a' }, { id: 'b' }, { id: 'c' });
    // Selection says ['c','a'] but directory order is ['a','b','c'], so result is ['a','c']
    expect(getSelectedEntries(selection, entries)).toEqual([entries[0], entries[2]]);
  });
});

describe('getSelectedEntryLocations', () => {
  it('returns empty array when selection is undefined', () => {
    const entries = makeEntries({ id: 'a' });
    expect(getSelectedEntryLocations(undefined, entries)).toEqual([]);
  });

  it('returns locations for matching entries', () => {
    const selection: SelectionState = { selectedEntryIds: ['b', 'c'] };
    const entries = makeEntries(
      { id: 'a', locationUri: '/dir/a' },
      { id: 'b', locationUri: '/dir/b' },
      { id: 'c', locationUri: '/dir/c' },
    );
    const locations = getSelectedEntryLocations(selection, entries);
    expect(locations).toEqual([
      entries[1]!.location,
      entries[2]!.location,
    ]);
  });

  it('is equivalent to getSelectedEntries().map(entry => entry.location)', () => {
    const selection: SelectionState = { selectedEntryIds: ['a', 'c'] };
    const entries = makeEntries({ id: 'a' }, { id: 'b' }, { id: 'c' });
    const locations = getSelectedEntryLocations(selection, entries);
    const expected = getSelectedEntries(selection, entries).map((e) => e.location);
    expect(locations).toEqual(expected);
  });
});
